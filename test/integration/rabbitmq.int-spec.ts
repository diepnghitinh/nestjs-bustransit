import { Logger } from '@nestjs/common';
import { BusTransitConsumer } from '../../lib/factories/consumer';
import { ConsumerConfigurator } from '../../lib/factories/consumer.configurator';
import { cleanup, closeOpened, createBus, describeWithBroker, eventually, killConnection, MANAGEMENT_URL, managementApi, rawChannel, vhostPath } from './support';

describeWithBroker('RabbitMQ transport against a real broker', () => {
  const prefix = `it${Date.now()}`;
  afterEach(() => closeOpened());
  afterAll(() => cleanup(prefix));

  it('starts and publishes whether or not the delayed-message plugin is installed', async () => {
    class AnyMessage {}
    const bus = createBus(prefix, { messages: { AnyMessage } });
    await bus.start();
    expect(bus.health().connected).toBe(true);
    await expect(bus.publish(new AnyMessage())).resolves.toBeUndefined();
    await bus.close();
  });

  it('publishes a message whose exchange nobody declared, and keeps publishing', async () => {
    class FunnelTrigger {}
    class AnalyticsBatch {
      id = 1;
    }
    const bus = createBus(prefix, { messages: { FunnelTrigger, AnalyticsBatch } });
    await bus.start();
    await expect(bus.publish(new FunnelTrigger())).resolves.toBeUndefined();
    await expect(bus.publish(new AnalyticsBatch())).resolves.toBeUndefined();

    const { connection, channel } = await rawChannel();
    await expect(channel.checkExchange(`${prefix}:FunnelTrigger`)).resolves.toBeDefined();
    await connection.close();
    await bus.close();
  });

  it('publishes to exchanges that already exist with other settings, as 0.3.x did', async () => {
    class Legacy {}
    class NotDurable {}
    const { connection, channel } = await rawChannel();
    await channel.assertExchange(`${prefix}:Legacy`, 'direct', { durable: true });
    await channel.assertExchange(`${prefix}:NotDurable`, 'fanout', { durable: false });
    await connection.close();

    const bus = createBus(prefix, { messages: { Legacy, NotDurable } });
    await bus.start();
    await expect(bus.publish(new Legacy())).resolves.toBeUndefined();
    await expect(bus.publish(new NotDurable())).resolves.toBeUndefined();
    await bus.close();
  });

  it('reproduces the 06/10 incident and keeps publishing', async () => {
    class SyncAnalyticsCampaignBatchMessage {
      batchId = 'b1';
    }
    class AggregateUrlAnalysisFunnelMessage {}
    const { connection, channel } = await rawChannel();
    await channel.assertExchange(`${prefix}:SyncAnalyticsCampaignBatchMessage`, 'fanout', { durable: true });
    await connection.close();

    const bus = createBus(prefix, { messages: { SyncAnalyticsCampaignBatchMessage, AggregateUrlAnalysisFunnelMessage } });
    await bus.start();
    await expect(bus.publish(new SyncAnalyticsCampaignBatchMessage())).resolves.toBeUndefined();
    await expect(bus.publish(new AggregateUrlAnalysisFunnelMessage())).resolves.toBeUndefined();
    await expect(bus.publish(new SyncAnalyticsCampaignBatchMessage())).resolves.toBeUndefined();
    await bus.close();
  });

  it('recovers when an exchange is deleted behind its back', async () => {
    class Volatile {}
    const bus = createBus(prefix, { messages: { Volatile } });
    await bus.start();
    await bus.publish(new Volatile());

    const { connection, channel } = await rawChannel();
    await channel.deleteExchange(`${prefix}:Volatile`);
    await connection.close();

    await expect(bus.publish(new Volatile())).rejects.toThrow(/NOT_FOUND/);
    await expect(bus.publish(new Volatile())).resolves.toBeUndefined();
    await bus.close();
  });

  (MANAGEMENT_URL ? it : it.skip)('consumes again after an operator kills the connection', async () => {
    class Ping {
      n: number;
    }
    const received: number[] = [];
    class PingConsumer extends BusTransitConsumer<Ping> {
      constructor() {
        super(Ping);
      }
      async Consume(ctx, context) {
        await super.Consume(ctx, context);
        received.push(context.Message.n);
      }
    }
    const queue = `${prefix}-ping`;
    const endpoint = new ConsumerConfigurator();
    endpoint.bindQueue(queue);
    endpoint.bindConsumer(PingConsumer);
    endpoint.setOptions({ PrefetchCount: 5 });
    const bus = createBus(prefix, {
      consumers: { PingConsumer },
      endpoints: { [queue]: endpoint },
      instances: new Map<unknown, unknown>([[PingConsumer, new PingConsumer()]]),
    });
    await bus.start();

    await bus.publish(Object.assign(new Ping(), { n: 1 }));
    await eventually(async () => expect(received).toContain(1));

    expect(await killConnection(prefix)).toBeGreaterThan(0);
    await eventually(() => bus.publish(Object.assign(new Ping(), { n: 2 })));
    await eventually(async () => expect(received).toContain(2));
    expect(bus.health().consumers[queue]).toBe('consuming');
    await bus.close();
  });

  it('re-creates a deleted error queue and keeps the failed message', async () => {
    class Boom {
      n: number;
    }
    class BoomConsumer extends BusTransitConsumer<Boom> {
      constructor() {
        super(Boom);
      }
      async Consume(ctx, context) {
        await super.Consume(ctx, context);
        throw new Error('boom');
      }
    }
    const queue = `${prefix}-boom`;
    const endpoint = new ConsumerConfigurator();
    endpoint.bindQueue(queue);
    endpoint.bindConsumer(BoomConsumer);
    const bus = createBus(prefix, {
      consumers: { BoomConsumer },
      endpoints: { [queue]: endpoint },
      instances: new Map<unknown, unknown>([[BoomConsumer, new BoomConsumer()]]),
    });
    await bus.start();
    const { connection } = await rawChannel();
    // A passive check on a missing queue closes the channel, so each attempt uses a new one.
    const messageCount = async () => {
      const channel = await connection.createChannel();
      channel.on('error', () => undefined);
      try {
        return (await channel.checkQueue(`${queue}_error`)).messageCount;
      } finally {
        await channel.close().catch(() => undefined);
      }
    };

    await bus.publish(Object.assign(new Boom(), { n: 1 }));
    await eventually(async () => expect(await messageCount()).toBe(1));

    const deleter = await connection.createChannel();
    deleter.on('error', () => undefined);
    await deleter.deleteQueue(`${queue}_error`);
    await deleter.close();

    await bus.publish(Object.assign(new Boom(), { n: 2 }));
    await eventually(async () => expect(await messageCount()).toBe(1), 20000);
    await connection.close();
    await bus.close();
  });
  /** Messages in a queue, or 0 when the queue does not exist (a passive check on a missing queue closes its channel). */
  async function messageCount(queue: string): Promise<number> {
    const { channel } = await rawChannel();
    try {
      return (await channel.checkQueue(queue)).messageCount;
    } catch {
      return 0;
    }
  }

  function requestReply(queueA: string, queueB: string, onSend: (send: () => Promise<any>) => Promise<void>) {
    class OrderStep {
      n = 1;
    }
    class ReserveStock {
      sku = 'sku-1';
    }
    let bus!: ReturnType<typeof createBus>;
    class OrderStepConsumer extends BusTransitConsumer<OrderStep> {
      constructor() {
        super(OrderStep);
      }
      async Consume(ctx, context) {
        await super.Consume(ctx, context);
        await onSend(() => bus.publishAsync(new ReserveStock()));
      }
    }
    class ReserveStockConsumer extends BusTransitConsumer<ReserveStock> {
      constructor() {
        super(ReserveStock);
      }
      async Consume(ctx, context): Promise<any> {
        await super.Consume(ctx, context);
        return { reserved: context.Message.sku };
      }
    }
    const endpointA = new ConsumerConfigurator();
    endpointA.bindQueue(queueA);
    endpointA.bindConsumer(OrderStepConsumer);
    const endpointB = new ConsumerConfigurator();
    endpointB.bindQueue(queueB);
    endpointB.bindConsumer(ReserveStockConsumer);
    return { OrderStep, ReserveStock, OrderStepConsumer, ReserveStockConsumer, endpointA, endpointB, setBus: (b: typeof bus) => (bus = b) };
  }

  it('sends a request to another queue and gets the reply', async () => {
    const queueA = `${prefix}-send-a`;
    const queueB = `${prefix}-send-b`;
    const replies: unknown[] = [];
    const flow = requestReply(queueA, queueB, async (send) => {
      replies.push(await send());
    });
    const bus = flow.setBus(
      createBus(prefix, {
        messages: { ReserveStock: { Name: queueB } },
        consumers: { OrderStepConsumer: flow.OrderStepConsumer, ReserveStockConsumer: flow.ReserveStockConsumer },
        endpoints: { [queueA]: flow.endpointA, [queueB]: flow.endpointB },
        instances: new Map<unknown, unknown>([
          [flow.OrderStepConsumer, new flow.OrderStepConsumer()],
          [flow.ReserveStockConsumer, new flow.ReserveStockConsumer()],
        ]),
      }),
    );
    await bus.start();
    await expect(bus.publishAsync(new flow.ReserveStock())).resolves.toEqual({ reserved: 'sku-1' });
    await bus.publish(new flow.OrderStep());
    await eventually(async () => expect(replies).toEqual([{ reserved: 'sku-1' }]));
    expect(await messageCount(`${queueA}_error`)).toBe(0);
    await bus.close();
  });

  it('leaves a message whose Send fails during shutdown in its queue instead of the error queue', async () => {
    const queueA = `${prefix}-drain-a`;
    const queueB = `${prefix}-drain-b`;
    let sendError = '';
    let handlerStarted = false;
    const flow = requestReply(queueA, queueB, async (send) => {
      handlerStarted = true;
      await new Promise((resolve) => setTimeout(resolve, 300)); // B's consumer is cancelled meanwhile
      try {
        await send();
      } catch (err) {
        sendError = err.message;
        throw err;
      }
    });
    const bus = flow.setBus(
      createBus(prefix, {
        messages: { ReserveStock: { Name: queueB } },
        consumers: { OrderStepConsumer: flow.OrderStepConsumer, ReserveStockConsumer: flow.ReserveStockConsumer },
        endpoints: { [queueA]: flow.endpointA, [queueB]: flow.endpointB },
        instances: new Map<unknown, unknown>([
          [flow.OrderStepConsumer, new flow.OrderStepConsumer()],
          [flow.ReserveStockConsumer, new flow.ReserveStockConsumer()],
        ]),
        reliability: { sendTimeoutMs: 1000, shutdownTimeoutMs: 5000 },
      }),
    );
    await bus.start();
    await bus.publish(new flow.OrderStep());
    await eventually(async () => expect(handlerStarted).toBe(true));

    const started = Date.now();
    await bus.stopConsuming();
    await bus.close();
    expect(Date.now() - started).toBeLessThan(5000);
    expect(sendError).toMatch(/No response received/);
    await eventually(async () => expect(await messageCount(queueA)).toBe(1));
    expect(await messageCount(`${queueA}_error`)).toBe(0);
    expect(await messageCount(queueB)).toBe(1); // the request itself waits for the next consumer, as in 0.3.x
  });
  it('consumes nothing when stopConsuming() ran before the connection setup finished', async () => {
    class Doomed {
      n = 1;
    }
    let calls = 0;
    class DoomedConsumer extends BusTransitConsumer<Doomed> {
      constructor() {
        super(Doomed);
      }
      async Consume(ctx, context) {
        await super.Consume(ctx, context);
        calls++;
        throw new Error('db pool closed');
      }
    }
    const queue = `${prefix}-late`;
    const endpoint = new ConsumerConfigurator();
    endpoint.bindQueue(queue);
    endpoint.bindConsumer(DoomedConsumer);
    const { channel } = await rawChannel();
    await channel.assertQueue(queue, { durable: true });
    channel.sendToQueue(queue, Buffer.from(JSON.stringify({ message: { n: 1 }, headers: {} })));
    await eventually(async () => expect(await messageCount(queue)).toBe(1));

    const bus = createBus(prefix, {
      consumers: { DoomedConsumer },
      endpoints: { [queue]: endpoint },
      instances: new Map<unknown, unknown>([[DoomedConsumer, new DoomedConsumer()]]),
    });
    await bus.stopConsuming(); // SIGTERM before the first connection setup finished
    await bus.start();
    await new Promise((resolve) => setTimeout(resolve, 1000));
    expect(calls).toBe(0);
    expect(bus.health().consumers).toEqual({});
    await bus.close();
    expect(await messageCount(queue)).toBe(1);
    expect(await messageCount(`${queue}_error`)).toBe(0);
  });

  it('brings back a deleted message exchange and its binding without a reconnect', async () => {
    class Refreshed {
      n: number;
    }
    const seen: number[] = [];
    class RefreshedConsumer extends BusTransitConsumer<Refreshed> {
      constructor() {
        super(Refreshed);
      }
      async Consume(ctx, context) {
        await super.Consume(ctx, context);
        seen.push(context.Message.n);
      }
    }
    const queue = `${prefix}-refresh`;
    const endpoint = new ConsumerConfigurator();
    endpoint.bindQueue(queue);
    endpoint.bindConsumer(RefreshedConsumer);
    const consumerBus = createBus(prefix, {
      consumers: { RefreshedConsumer },
      endpoints: { [queue]: endpoint },
      instances: new Map<unknown, unknown>([[RefreshedConsumer, new RefreshedConsumer()]]),
      reliability: { topologyRefreshMs: 500 },
    });
    // Another process that only publishes, like api-portal.
    const publisherBus = createBus(prefix, { messages: { Refreshed } });
    await consumerBus.start();
    await publisherBus.start();

    await publisherBus.publish(Object.assign(new Refreshed(), { n: 1 }));
    await eventually(async () => expect(seen).toContain(1));

    const { connection, channel } = await rawChannel();
    await channel.deleteExchange(`${prefix}:Refreshed`);
    await connection.close();

    // Publish every 100 ms; consumption must resume once the consumer's refresh re-binds the exchange.
    let n = 2;
    const deletedAt = Date.now();
    const ticker = setInterval(() => {
      void publisherBus.publish(Object.assign(new Refreshed(), { n: n++ })).catch(() => undefined);
    }, 100);
    try {
      await eventually(async () => expect(seen.some((value) => value >= 2)).toBe(true), 5000);
    } finally {
      clearInterval(ticker);
    }
    expect(Date.now() - deletedAt).toBeLessThan(3000);
    expect(consumerBus.health().connected).toBe(true);
    await publisherBus.close();
    await consumerBus.close();
  });

  it('refreshes around an exchange that exists as direct without a 406 or a failed concurrent publish', async () => {
    class Existing {
      n: number;
    }
    class Fresh {}
    class ExistingConsumer extends BusTransitConsumer<Existing> {
      constructor() {
        super(Existing);
      }
    }
    const { connection, channel } = await rawChannel();
    await channel.assertExchange(`${prefix}:Existing`, 'direct', { durable: true });
    await connection.close();
    const queue = `${prefix}-existing`;
    const endpoint = new ConsumerConfigurator();
    endpoint.bindQueue(queue);
    endpoint.bindConsumer(ExistingConsumer);
    const bus = createBus(prefix, {
      consumers: { ExistingConsumer },
      endpoints: { [queue]: endpoint },
      messages: { Existing, Fresh },
      instances: new Map<unknown, unknown>([[ExistingConsumer, new ExistingConsumer()]]),
      reliability: { topologyRefreshMs: 300 },
    });
    const errorSpy = jest.spyOn(Logger, 'error').mockImplementation(() => undefined);
    await bus.start();
    // Bound at startup, not only after the first refresh.
    const bindings = (await (await managementApi(`/exchanges/${vhostPath()}/${encodeURIComponent(`${prefix}:Existing`)}/bindings/source`)).json()) as unknown[];
    expect(bindings.length).toBeGreaterThan(0);
    const results: PromiseSettledResult<void>[] = [];
    for (let i = 0; i < 20; i++) {
      // Each round publishes to an exchange that does not exist yet while refreshes run.
      const Dynamic = class {};
      Object.defineProperty(Dynamic, 'name', { value: `Dyn${i}` });
      results.push(...(await Promise.allSettled([bus.publish(new Dynamic())])));
      await new Promise((resolve) => setTimeout(resolve, 60));
    }
    const refused = errorSpy.mock.calls.filter(([msg]) => /406|PRECONDITION|Declaration refused/.test(String(msg)));
    errorSpy.mockRestore();
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(0);
    expect(refused).toHaveLength(0);
    expect(bus.health().consumers[queue]).toBe('consuming');
    await bus.close();
  });
});
