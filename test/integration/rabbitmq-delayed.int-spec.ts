import { Logger } from '@nestjs/common';
import { BusTransitConsumer } from '../../lib/factories/consumer';
import { ConsumerConfigurator } from '../../lib/factories/consumer.configurator';
import { RetryConfigurator } from '../../lib/factories/retry.configurator';
import {
  cleanup,
  closeOpened,
  createBus,
  DELAYED_MANAGEMENT_URL,
  DELAYED_URL,
  describeWithDelayedBroker,
  eventually,
  killConnection,
  managementApi,
  rawChannel,
  useBroker,
  vhostPath,
} from './support';

/**
 * Delayed redelivery against a broker that has the rabbitmq_delayed_message_exchange plugin
 * (RABBITMQ_DELAYED_URL + RABBITMQ_DELAYED_MANAGEMENT_URL). Skipped when they are not set.
 */
describeWithDelayedBroker('RabbitMQ delayed redelivery against a broker with the delayed-message plugin', () => {
  const prefix = `itd${Date.now()}`;
  beforeAll(() => useBroker(DELAYED_URL!, DELAYED_MANAGEMENT_URL));
  afterEach(() => closeOpened());
  afterAll(() => cleanup(prefix));

  interface Delivery {
    n: number;
    at: number;
    redelivery: number;
  }

  class Job {
    n: number;
  }

  /**
   * A queue whose consumer records every delivery and fails while `fail(delivery)` says so.
   * Each call gets its own message and consumer classes, so buses never share routing maps.
   */
  function redeliveringBus(
    queue: string,
    intervals: number[] | null,
    fail: (delivery: Delivery) => boolean,
    opts: { prefetch?: number; extra?: { consumers: Record<string, unknown>; endpoints: Record<string, unknown>; instances: [unknown, unknown][]; messages?: Record<string, unknown> } } = {},
  ) {
    const deliveries: Delivery[] = [];
    const successes: Delivery[] = [];
    class JobConsumer extends BusTransitConsumer<Job> {
      constructor() {
        super(Job);
      }
      async Consume(ctx, context) {
        await super.Consume(ctx, context);
        const delivery = {
          n: context.Message.n,
          at: Date.now(),
          redelivery: Number(context.properties?.headers?.['x-redelivery'] ?? 0),
        };
        deliveries.push(delivery);
        if (fail(delivery)) throw new Error(`job ${delivery.n} failed (attempt ${delivery.redelivery})`);
        successes.push(delivery);
      }
    }
    const endpoint = new ConsumerConfigurator();
    endpoint.bindQueue(queue);
    endpoint.bindConsumer(JobConsumer);
    if (opts.prefetch) endpoint.setOptions({ PrefetchCount: opts.prefetch });
    if (intervals) endpoint.UseDelayedRedelivery((r: RetryConfigurator) => r.Intervals(...intervals));
    const bus = createBus(prefix, {
      messages: { Job, ...(opts.extra?.messages ?? {}) },
      consumers: { JobConsumer, ...(opts.extra?.consumers ?? {}) },
      endpoints: { [queue]: endpoint, ...(opts.extra?.endpoints ?? {}) },
      instances: new Map<unknown, unknown>([[JobConsumer, new JobConsumer()], ...(opts.extra?.instances ?? [])]),
    });
    const publish = (n: number) => bus.publish(Object.assign(new Job(), { n }));
    return { bus, deliveries, successes, publish };
  }

  /** Messages in a queue, or 0 when the queue does not exist. */
  async function messageCount(queue: string): Promise<number> {
    const { connection, channel } = await rawChannel();
    try {
      return (await channel.checkQueue(queue)).messageCount;
    } catch {
      return 0;
    } finally {
      await connection.close().catch(() => undefined);
    }
  }

  /** Removes and returns every message of a queue, parsed. */
  async function drain(queue: string): Promise<any[]> {
    const { connection, channel } = await rawChannel();
    const out: any[] = [];
    try {
      for (;;) {
        const msg = await channel.get(queue, { noAck: true });
        if (!msg) break;
        out.push({ body: JSON.parse(msg.content.toString()), headers: msg.properties.headers });
      }
    } finally {
      await connection.close().catch(() => undefined);
    }
    return out;
  }

  async function exchangeInfo(name: string): Promise<any | null> {
    const res = await managementApi(`/exchanges/${vhostPath()}/${encodeURIComponent(name)}`);
    return res.status === 404 ? null : res.json();
  }

  async function bindingsFrom(exchange: string): Promise<any[]> {
    const res = await managementApi(`/exchanges/${vhostPath()}/${encodeURIComponent(exchange)}/bindings/source`);
    return res.ok ? ((await res.json()) as any[]) : [];
  }

  const delayExchangeOf = (queue: string) => `${prefix}:delayed.exchange.${queue}`;
  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  it('detects the plugin at start and declares the delay exchange bound to the queue', async () => {
    const logs: string[] = [];
    const spy = jest.spyOn(Logger, 'log').mockImplementation((message: any) => {
      logs.push(String(message));
    });
    try {
      const queue = `${prefix}-detect`;
      const { bus } = redeliveringBus(queue, [300], () => false);
      await bus.start();
      await eventually(async () => expect(bus.health().consumers[queue]).toBe('consuming'));

      expect(bus.isDelayedMessagePluginSupported()).toBe(true);
      expect(bus.isRedeliveryEnabledForQueue(queue)).toBe(true);
      expect(logs.some((l) => l.includes('x-delayed-message plugin is available'))).toBe(true);
      expect(logs.some((l) => l.includes(`Redelivery enabled for queue '${queue}'`))).toBe(true);

      const exchange = await exchangeInfo(delayExchangeOf(queue));
      expect(exchange).toMatchObject({ type: 'x-delayed-message', durable: true, auto_delete: false, arguments: { 'x-delayed-type': 'direct' } });
      const bindings = await bindingsFrom(delayExchangeOf(queue));
      expect(bindings).toEqual([expect.objectContaining({ destination: queue, destination_type: 'queue', routing_key: '' })]);
      await bus.close();
    } finally {
      spy.mockRestore();
    }
  });

  it('redelivers after each configured delay, then parks the message in the error queue with its history', async () => {
    const queue = `${prefix}-delay`;
    const intervals = [300, 500];
    const { bus, deliveries, publish } = redeliveringBus(queue, intervals, () => true);
    await bus.start();
    await publish(1);

    await eventually(async () => expect(await messageCount(`${queue}_error`)).toBe(1), 10000);
    await sleep(1000); // nothing more may arrive: no duplicate delivery, no second error copy
    expect(deliveries.map((d) => d.redelivery)).toEqual([0, 1, 2]);
    const gaps = deliveries.slice(1).map((d, i) => d.at - deliveries[i].at);
    console.log(`[delayed] configured ${intervals.join('/')} ms, measured gaps ${gaps.join('/')} ms`);
    gaps.forEach((gap, i) => expect(gap).toBeGreaterThanOrEqual(intervals[i] - 5));
    gaps.forEach((gap, i) => expect(gap).toBeLessThan(intervals[i] + 2000));

    expect(await messageCount(queue)).toBe(0);
    const parked = await drain(`${queue}_error`);
    expect(parked).toHaveLength(1);
    expect(parked[0].body.retryHistory).toEqual({ immediateRetries: 0, redeliveryAttempts: 2 });
    expect(parked[0].body.headers['x-redelivery']).toBe(2);
    expect(parked[0].body.message.message).toEqual({ n: 1 });
    expect(parked[0].body.error.message).toBe('job 1 failed (attempt 2)');
    await bus.close();
  });

  it('delivers a message that fails once exactly one more time, then acks it', async () => {
    const queue = `${prefix}-once`;
    const { bus, deliveries, successes, publish } = redeliveringBus(queue, [300, 300], (d) => d.redelivery === 0);
    await bus.start();
    await publish(7);

    await eventually(async () => expect(successes).toHaveLength(1), 10000);
    await sleep(1000);
    expect(deliveries.map((d) => [d.n, d.redelivery])).toEqual([
      [7, 0],
      [7, 1],
    ]);
    expect(deliveries[1].at - deliveries[0].at).toBeGreaterThanOrEqual(295);
    expect(await messageCount(queue)).toBe(0);
    expect(await messageCount(`${queue}_error`)).toBe(0);
    await bus.close();
  });

  it('parks failed messages in the error queue while the delay exchange is gone, and restores it on the next start', async () => {
    class Side {
      i: number;
    }
    const sideReceived: number[] = [];
    class SideConsumer extends BusTransitConsumer<Side> {
      constructor() {
        super(Side);
      }
      async Consume(ctx, context) {
        await super.Consume(ctx, context);
        sideReceived.push(context.Message.i);
      }
    }
    const sideQueue = `${prefix}-side`;
    const sideEndpoint = new ConsumerConfigurator();
    sideEndpoint.bindQueue(sideQueue);
    sideEndpoint.bindConsumer(SideConsumer);

    const queue = `${prefix}-gone`;
    const { bus, deliveries, successes, publish } = redeliveringBus(queue, [300], (d) => d.redelivery === 0, {
      extra: {
        messages: { Side },
        consumers: { SideConsumer },
        endpoints: { [sideQueue]: sideEndpoint },
        instances: [[SideConsumer, new SideConsumer()]],
      },
    });
    await bus.start();
    await eventually(async () => expect(bus.health().consumers[queue]).toBe('consuming'));

    const deleted = await managementApi(`/exchanges/${vhostPath()}/${encodeURIComponent(delayExchangeOf(queue))}`, { method: 'DELETE' });
    expect(deleted.status).toBe(204);

    // The failing message and application publishes on the shared producer channel, at the same time.
    let publishing = true;
    const sidePublishes: Promise<void>[] = [];
    const sideLoop = (async () => {
      for (let i = 0; publishing; i++) {
        sidePublishes.push(bus.publish(Object.assign(new Side(), { i })));
        await sleep(10);
      }
    })();
    await sleep(200); // application publishes before, during and after the failed message is parked
    await publish(1);
    await eventually(async () => expect(await messageCount(`${queue}_error`)).toBe(1), 10000);
    await sleep(300);
    publishing = false;
    await sideLoop;
    const sideResults = await Promise.allSettled(sidePublishes);
    expect(sideResults.filter((r) => r.status === 'rejected')).toEqual([]);
    expect(sidePublishes.length).toBeGreaterThanOrEqual(20);
    console.log(`[delayed] exchange gone: ${sidePublishes.length} concurrent application publishes, all confirmed`);
    await eventually(async () => expect(sideReceived).toHaveLength(sidePublishes.length));
    expect(deliveries.map((d) => [d.n, d.redelivery])).toEqual([[1, 0]]);
    expect(await exchangeInfo(delayExchangeOf(queue))).toBeNull(); // the bus does not re-create it mid-run
    const parked = await drain(`${queue}_error`);
    expect(parked).toHaveLength(1);
    expect(parked[0].body.retryHistory).toEqual({ immediateRetries: 0, redeliveryAttempts: 0 });

    // The consumer's next start (here: after an operator kills the connection) restores the exchange and its binding.
    expect(await killConnection(prefix)).toBeGreaterThan(0);
    await eventually(async () => {
      expect(bus.health().consumers[queue]).toBe('consuming');
      expect(await exchangeInfo(delayExchangeOf(queue))).toMatchObject({ type: 'x-delayed-message' });
      expect(await bindingsFrom(delayExchangeOf(queue))).toEqual([expect.objectContaining({ destination: queue })]);
    }, 20000);

    await eventually(() => publish(2));
    await eventually(async () => expect(successes.map((d) => d.n)).toContain(2), 10000);
    expect(deliveries.filter((d) => d.n === 2).map((d) => d.redelivery)).toEqual([0, 1]);
    expect(await messageCount(`${queue}_error`)).toBe(0);
    await bus.close();
  });

  it('conserves every message when many fail at once', async () => {
    const queue = `${prefix}-many`;
    const total = 50;
    // Even numbers fail once then succeed; odd numbers always fail and end in the error queue.
    const { bus, deliveries, successes, publish } = redeliveringBus(queue, [200, 300], (d) => d.n % 2 === 1 || d.redelivery === 0);
    await bus.start();
    await Promise.all(Array.from({ length: total }, (_, n) => publish(n)));

    const odd = Array.from({ length: total / 2 }, (_, i) => 2 * i + 1);
    const even = Array.from({ length: total / 2 }, (_, i) => 2 * i);
    await eventually(async () => {
      expect(successes).toHaveLength(even.length);
      expect(await messageCount(`${queue}_error`)).toBe(odd.length);
    }, 20000);
    await sleep(1500); // let any duplicate show up
    expect(successes.map((d) => d.n).sort((a, b) => a - b)).toEqual(even);
    expect(successes.every((d) => d.redelivery === 1)).toBe(true);
    expect(deliveries).toHaveLength(even.length * 2 + odd.length * 3);
    expect(await messageCount(queue)).toBe(0);
    const parked = await drain(`${queue}_error`);
    expect(parked.map((p) => p.body.message.message.n).sort((a, b) => a - b)).toEqual(odd);
    expect(parked.every((p) => p.body.retryHistory.redeliveryAttempts === 2)).toBe(true);
    console.log(`[delayed] ${total} messages: ${successes.length} succeeded after one redelivery, ${parked.length} parked, ${deliveries.length} deliveries`);
    await bus.close();
  });

  it('keeps delayed messages across a shutdown and delivers them to the next bus', async () => {
    const queue = `${prefix}-restart`;
    const delay = 6000; // long enough that a slow shutdown on a busy CI runner still ends before the delay
    const first = redeliveringBus(queue, [delay], () => true);
    await first.bus.start();
    const sent = [1, 2, 3, 4, 5];
    await Promise.all(sent.map((n) => first.publish(n)));
    await eventually(async () => expect(first.deliveries).toHaveLength(sent.length));
    const parkedAt = Math.max(...first.deliveries.map((d) => d.at));
    await eventually(async () => expect(await messageCount(queue)).toBe(0)); // all acked: they are in the delay exchange
    const delayed = await exchangeInfo(delayExchangeOf(queue));
    if (delayed?.messages_delayed !== undefined) expect(delayed.messages_delayed).toBe(sent.length);
    console.log(`[delayed] restart: messages_delayed reported by the plugin before shutdown: ${delayed?.messages_delayed}`);
    await first.bus.stopConsuming();
    await first.bus.close();
    expect(Date.now() - parkedAt).toBeLessThan(delay); // they are still pending when the next bus starts

    const second = redeliveringBus(queue, [delay], () => false);
    await second.bus.start();
    await eventually(async () => expect(second.successes).toHaveLength(sent.length), 15000);
    await sleep(500);
    expect(second.successes.map((d) => d.n).sort()).toEqual(sent);
    expect(second.successes.every((d) => d.redelivery === 1)).toBe(true);
    const earliest = Math.min(...second.successes.map((d) => d.at));
    const firstParkedAt = Math.min(...first.deliveries.map((d) => d.at));
    console.log(`[delayed] restart: first redelivery ${earliest - firstParkedAt} ms after the first failure (delay ${delay} ms)`);
    expect(earliest - firstParkedAt).toBeGreaterThanOrEqual(delay - 5);
    expect(first.deliveries).toHaveLength(sent.length);
    expect(await messageCount(queue)).toBe(0);
    expect(await messageCount(`${queue}_error`)).toBe(0);
    await second.bus.close();
  });
});
