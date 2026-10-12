jest.mock('amqplib', () => ({ connect: jest.fn() }));
import { Logger } from '@nestjs/common';
import * as amqp from 'amqplib';
import { Publisher } from '../lib/factories/brokers/rabbitmq/publisher';
import { BusTransitConsumer } from '../lib/factories/consumer';
import { ConsumerConfigurator } from '../lib/factories/consumer.configurator';
import { RetryConfigurator, RetryLevel } from '../lib/factories/retry.configurator';
import { eventually, sleep, startBroker } from './support/broker-fixture';
import { createFakeBroker, FakeConnection, mainConnections } from './support/fake-amqp';
import { OrderStateMachine, PingConsumer, startWithTopology } from './support/topology-fixture';
import { IPublishEndpoint } from '../lib/interfaces/publish-endpoint.interface';

class SyncAnalyticsCampaignBatchMessage {
  batchId = 'b-1';
}
class AggregateUrlAnalysisFunnelMessage {}
class OrderPlaced {
  orderId = 'o-1';
}
class PingMessage {
  text: string;
}
class SlowPingConsumer extends BusTransitConsumer<PingMessage> {
  done = 0;
  constructor() {
    super(PingMessage);
  }
  async Consume(ctx, context) {
    await super.Consume(ctx, context);
    await sleep(80);
    this.done++;
  }
}

function pingEndpoint(consumer: unknown, redelivery = false) {
  const endpoint = new ConsumerConfigurator();
  endpoint.bindQueue('ping');
  endpoint.bindConsumer(consumer as any);
  endpoint.setOptions({ PrefetchCount: 5 });
  if (redelivery) endpoint.UseDelayedRedelivery((r: RetryConfigurator) => r.Intervals(1000));
  return endpoint;
}

describe('BusTransitBrokerRabbitMqFactory', () => {
  it('survives the 06/10 incident end to end', async () => {
    const { bus, broker } = await startBroker({
      messages: { SyncAnalyticsCampaignBatchMessage, AggregateUrlAnalysisFunnelMessage },
      preexistingExchanges: { 'linkadz:SyncAnalyticsCampaignBatchMessage': 'fanout' },
    });
    await expect(bus.publish(new AggregateUrlAnalysisFunnelMessage())).resolves.toBeUndefined();
    await expect(bus.publish(new SyncAnalyticsCampaignBatchMessage())).resolves.toBeUndefined();
    expect(broker.channels.filter((c) => c.confirm)).toHaveLength(1);
    expect(broker.channels.find((c) => c.confirm)!.closed).toBe(false);
    await bus.close();
  });

  it('starts and publishes on a broker without the delayed-message plugin', async () => {
    const broker = createFakeBroker();
    broker.delayedPlugin = false;
    const consumer = new SlowPingConsumer();
    const { bus } = await startBroker({
      broker,
      messages: { OrderPlaced },
      consumers: { SlowPingConsumer },
      endpoints: { ping: pingEndpoint(SlowPingConsumer, true) },
      instances: new Map<unknown, unknown>([[SlowPingConsumer, consumer]]),
    });
    expect(bus.health().connected).toBe(true);
    expect(mainConnections(broker)[0].closed).toBe(false);
    expect(bus.isDelayedMessagePluginSupported()).toBe(false);
    expect(bus.isRedeliveryEnabledForQueue('ping')).toBe(false);
    await expect(bus.publish(new OrderPlaced())).resolves.toBeUndefined();
    await bus.close();
  });

  it('keeps publishing and other consumers running when one queue cannot be declared', async () => {
    const broker = createFakeBroker();
    broker.queueConflicts.add('ping');
    const { bus } = await startWithTopology({ broker });
    expect(bus.health()).toEqual({
      connected: true,
      blocked: false,
      consumers: { ping: 'restarting', 'order-saga': 'consuming' },
    });
    await expect(bus.publish(new OrderPlaced())).resolves.toBeUndefined();
    await bus.close();
  });

  it('waits for messages in progress on close and does not reconnect', async () => {
    const consumer = new SlowPingConsumer();
    const { bus, broker } = await startBroker({
      consumers: { SlowPingConsumer },
      endpoints: { ping: pingEndpoint(SlowPingConsumer) },
      instances: new Map<unknown, unknown>([[SlowPingConsumer, consumer]]),
    });
    const channel = broker.channels.find((c) => c.consumers.has('ping'))!;
    channel.deliver('ping', { message: { text: 'slow' }, headers: {} });
    await sleep(10);

    await bus.close();
    expect(consumer.done).toBe(1);
    expect(channel.acks).toHaveLength(1);
    expect(mainConnections(broker)[0].closed).toBe(true);
    await sleep(60);
    expect(mainConnections(broker)).toHaveLength(1);
    expect(bus.health().consumers.ping).toBe('stopped');
  });

  it('lets a publish made before start() wait for the connection', async () => {
    const { bus } = await startBroker({ messages: { OrderPlaced }, start: false });
    const pending = bus.publish(new OrderPlaced());
    await bus.start();
    await expect(pending).resolves.toBeUndefined();
    await bus.close();
  });

  it('resumes publishing and consuming after the connection drops', async () => {
    const { bus, broker } = await startWithTopology();
    mainConnections(broker)[0].drop();
    await expect(bus.publish(new OrderPlaced())).resolves.toBeUndefined();
    await eventually(() => bus.health().consumers.ping === 'consuming');
    expect(mainConnections(broker)).toHaveLength(2);
    await bus.close();
  });
});

describe('BusTransitBrokerRabbitMqFactory topology refresh', () => {
  it('declares exchanges and bindings again on a timer, so a deleted exchange comes back', async () => {
    const { bus, broker } = await startBroker({
      consumers: { PingConsumer },
      endpoints: { ping: pingEndpoint(PingConsumer) },
      instances: new Map<unknown, unknown>([[PingConsumer, new PingConsumer()]]),
      reliability: { topologyRefreshMs: 50 },
    });
    await eventually(() => bus.health().consumers.ping === 'consuming');
    const messageExchange = 'linkadz:PingMessage';
    const queueExchange = 'linkadz:ping';
    expect(broker.exchanges.has(messageExchange)).toBe(true);

    // An operator deletes both exchanges; RabbitMQ drops their bindings with them.
    broker.exchanges.delete(messageExchange);
    broker.exchanges.delete(queueExchange);
    broker.bindings = broker.bindings.filter(
      (b) => ![b.source, b.dest].some((name) => name === messageExchange || name === queueExchange),
    );
    const connectionsBefore = broker.connections.length;

    await eventually(() => broker.exchanges.has(messageExchange) && broker.exchanges.has(queueExchange));
    await eventually(() => broker.bindings.some((b) => b.source === messageExchange && b.dest === queueExchange));
    await eventually(() => broker.bindings.some((b) => b.source === queueExchange && b.dest === 'queue:ping'));
    expect(broker.connections.length).toBe(connectionsBefore); // no reconnect needed
    await bus.close();
  });

  it('stops refreshing topology after stopConsuming()', async () => {
    const { bus, broker } = await startBroker({
      consumers: { PingConsumer },
      endpoints: { ping: pingEndpoint(PingConsumer) },
      instances: new Map<unknown, unknown>([[PingConsumer, new PingConsumer()]]),
      reliability: { topologyRefreshMs: 50 },
    });
    await eventually(() => bus.health().consumers.ping === 'consuming');
    await eventually(() => (bus as any).topologyTimer !== null);
    await bus.stopConsuming();
    expect((bus as any).topologyTimer).toBeNull(); // fails if stopConsuming() does not clear the timer
    const asserted = broker.asserts.length;
    await sleep(200);
    expect(broker.asserts.length).toBe(asserted);
    await bus.close();
  });

  it('starts against exchanges that exist with other settings: binds at once, no error log, no consumer restart, refresh stays off the shared channel', async () => {
    const error = jest.spyOn(Logger, 'error').mockImplementation(() => undefined);
    const warn = jest.spyOn(Logger, 'warn').mockImplementation(() => undefined);
    const { bus, broker } = await startBroker({
      consumers: { PingConsumer },
      endpoints: { ping: pingEndpoint(PingConsumer) },
      instances: new Map<unknown, unknown>([[PingConsumer, new PingConsumer()]]),
      preexistingExchanges: { 'linkadz:PingMessage': 'direct', 'linkadz:ping': 'direct' },
      reliability: { topologyRefreshMs: 30 },
    });
    await eventually(() => bus.health().consumers.ping === 'consuming');
    // Bound from the start, not only after the first refresh.
    expect(broker.bindings).toContainEqual({ source: 'linkadz:PingMessage', dest: 'linkadz:ping' });
    expect(broker.bindings).toContainEqual({ source: 'linkadz:ping', dest: 'queue:ping' });
    expect(error).not.toHaveBeenCalled();
    const runner = (bus as any).runners.get('ping');
    const starts = jest.spyOn(runner, 'start');
    const publisher = (bus as any).publisher as Publisher;
    const sharedChannel = jest.spyOn(publisher as any, 'topologyChannel');
    const refresh = jest.spyOn(bus as any, 'refreshTopology');
    await sleep(50); // let a refresh in progress at this point end
    const asserts = broker.asserts.length;
    const refreshes = refresh.mock.calls.length;
    const warns = warn.mock.calls.length;
    sharedChannel.mockClear();
    await sleep(300);
    expect(refresh.mock.calls.length - refreshes).toBeGreaterThanOrEqual(3);
    expect(sharedChannel).not.toHaveBeenCalled(); // the refresh never used the shared _topology channel
    expect(error).not.toHaveBeenCalled();
    expect(warn.mock.calls.length).toBe(warns);
    expect(broker.asserts.length).toBe(asserts);
    expect(starts).not.toHaveBeenCalled();
    expect(broker.exchanges.get('linkadz:PingMessage')).toBe('direct');
    expect(bus.health().consumers.ping).toBe('consuming');
    error.mockRestore();
    warn.mockRestore();
    await bus.close();
  });

  it('keeps exactly one refresh timer across a disconnect and reconnect', async () => {
    const { bus, broker } = await startBroker({
      consumers: { PingConsumer },
      endpoints: { ping: pingEndpoint(PingConsumer) },
      instances: new Map<unknown, unknown>([[PingConsumer, new PingConsumer()]]),
      reliability: { topologyRefreshMs: 100 },
    });
    await eventually(() => bus.health().consumers.ping === 'consuming');
    mainConnections(broker)[0].drop();
    await eventually(() => !bus.health().connected);
    expect((bus as any).topologyTimer).toBeNull();
    await eventually(() => bus.health().connected && bus.health().consumers.ping === 'consuming');
    const refresh = jest.spyOn(bus as any, 'refreshTopology');
    await sleep(1000);
    // One timer fires about 9 times in a second; a duplicate would double that.
    expect(refresh.mock.calls.length).toBeGreaterThanOrEqual(4);
    expect(refresh.mock.calls.length).toBeLessThanOrEqual(11);
    await bus.close();
  });

  it('declares the delay exchange and its binding again when redelivery is enabled', async () => {
    const { bus, broker } = await startBroker({
      consumers: { PingConsumer },
      endpoints: { ping: pingEndpoint(PingConsumer, true) },
      instances: new Map<unknown, unknown>([[PingConsumer, new PingConsumer()]]),
      reliability: { topologyRefreshMs: 50 },
    });
    await eventually(() => bus.health().consumers.ping === 'consuming' && bus.isRedeliveryEnabledForQueue('ping'));
    const delay = 'linkadz:delayed.exchange.ping';
    expect(broker.exchanges.get(delay)).toBe('x-delayed-message');
    broker.exchanges.delete(delay);
    broker.bindings = broker.bindings.filter((b) => b.source !== delay);
    await eventually(() => broker.exchanges.get(delay) === 'x-delayed-message');
    await eventually(() => broker.bindings.some((b) => b.source === delay && b.dest === 'queue:ping'));
    await bus.close();
  });
});

describe('BusTransitBrokerRabbitMqFactory shutdown during topology work', () => {
  it('logs nothing more from a refresh that was blocked when stopConsuming() ran', async () => {
    const warn = jest.spyOn(Logger, 'warn').mockImplementation(() => undefined);
    try {
      const { bus, broker } = await startBroker({
        consumers: { PingConsumer },
        endpoints: { ping: pingEndpoint(PingConsumer) },
        instances: new Map<unknown, unknown>([[PingConsumer, new PingConsumer()]]),
        reliability: { topologyRefreshMs: 30, readyTimeoutMs: 2000 },
      });
      await eventually(() => bus.health().consumers.ping === 'consuming');
      let fail!: (err: Error) => void;
      const connection = mainConnections(broker)[0];
      connection.createChannel = jest.fn(() => new Promise((_, reject) => (fail = reject))) as any;
      await eventually(() => (connection.createChannel as jest.Mock).mock.calls.length > 0);
      await bus.stopConsuming();
      warn.mockClear();
      fail(new Error('Channel ended, no reply will be forthcoming')); // the socket went away under the blocked refresh
      await sleep(30);
      expect(warn.mock.calls.filter(([message]) => String(message).includes('Topology refresh'))).toEqual([]);
      await bus.close();
    } finally {
      warn.mockRestore();
    }
  });

  it('declares no topology and does not log "plugin NOT installed" when shutdown aborts the first probe', async () => {
    const warn = jest.spyOn(Logger, 'warn').mockImplementation(() => undefined);
    try {
      const broker = createFakeBroker();
      const { bus } = await startBroker({
        broker,
        start: false,
        consumers: { PingConsumer },
        endpoints: { ping: pingEndpoint(PingConsumer) },
        instances: new Map<unknown, unknown>([[PingConsumer, new PingConsumer()]]),
      });
      let probing = false;
      (amqp.connect as unknown as jest.Mock).mockImplementation(async (_url: unknown, socketOptions?: any) => {
        const name = socketOptions?.clientProperties?.connection_name ?? '';
        if (name.endsWith(':probe')) {
          probing = true;
          // A frozen broker: the handshake never answers, and only the abort ends it.
          return new Promise((_, reject) => socketOptions.signal.addEventListener('abort', () => reject(new Error('aborted'))));
        }
        return new FakeConnection(broker, name);
      });
      const starting = bus.start();
      await eventually(() => probing);
      await bus.stopConsuming();
      await starting;
      expect(warn.mock.calls.filter(([message]) => String(message).includes('NOT installed'))).toEqual([]);
      expect(bus.isDelayedMessagePluginSupported()).toBe(false);
      expect(broker.exchanges.size).toBe(0); // declareTopology did not run
      await bus.close();
    } finally {
      warn.mockRestore();
    }
  });
});

describe('BusTransitBrokerRabbitMqFactory publishing during shutdown', () => {
  it('routes a publish to the consumer queue when stopConsuming() ran before the first setup finished', async () => {
    const broker = createFakeBroker();
    const { bus } = await startBroker({
      broker,
      start: false,
      consumers: { PingConsumer },
      endpoints: { ping: pingEndpoint(PingConsumer) },
      instances: new Map<unknown, unknown>([[PingConsumer, new PingConsumer()]]),
    });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    (amqp.connect as unknown as jest.Mock).mockImplementation(async (_url: unknown, socketOptions?: any) => {
      await gate;
      return new FakeConnection(broker, socketOptions?.clientProperties?.connection_name ?? '');
    });
    const starting = bus.start();
    await sleep(10);
    await bus.stopConsuming(); // SIGTERM before the broker answered
    release();
    await starting;
    await bus.publish(new PingMessage());
    expect(broker.exchanges.has('linkadz:ping')).toBe(true); // the consumer's queue exchange, not the bare message class
    expect(broker.exchanges.has('linkadz:PingMessage')).toBe(false);
    expect((bus as any).classMessageToExchange.PingMessage).toBe('ping');
    expect((bus as any).classConsumerToEndpoint.PingConsumer).toBe('ping');
    await bus.close();
  });
});

describe('BusTransitBrokerRabbitMqFactory topology refresh timeout', () => {
  afterEach(() => jest.useRealTimers());

  it('warns once at readyTimeoutMs when the refresh channel never opens, and the next tick does not overlap', async () => {
    const warn = jest.spyOn(Logger, 'warn').mockImplementation(() => undefined);
    try {
      const { bus, broker } = await startBroker({
        consumers: { PingConsumer },
        endpoints: { ping: pingEndpoint(PingConsumer) },
        instances: new Map<unknown, unknown>([[PingConsumer, new PingConsumer()]]),
        reliability: { topologyRefreshMs: 60000, readyTimeoutMs: 200 },
      });
      await eventually(() => bus.health().consumers.ping === 'consuming');
      (bus as any).clearTopologyRefresh();
      const connection = mainConnections(broker)[0];
      const open = jest.fn(() => new Promise(() => undefined)); // the channel open never resolves
      connection.createChannel = open as any;
      warn.mockClear();

      jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
      const refresh = (bus as any).refreshTopology() as Promise<void>;
      await jest.advanceTimersByTimeAsync(199);
      expect(warn).not.toHaveBeenCalled();
      await jest.advanceTimersByTimeAsync(1);
      await refresh;
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0][0])).toContain('Topology refresh failed: [RabbitMQ] Topology refresh did not finish within 200ms');

      // The abandoned refresh is still stuck in its open, so the next tick must not start a second one.
      await (bus as any).refreshTopology();
      await jest.advanceTimersByTimeAsync(500);
      expect(open).toHaveBeenCalledTimes(1);
      expect(warn).toHaveBeenCalledTimes(1);
      jest.useRealTimers();
      await bus.close();
    } finally {
      warn.mockRestore();
    }
  });
});

describe('BusTransitBrokerRabbitMqFactory edge cases', () => {
  it('still runs a saga through the new delivery pipeline', async () => {
    const send = jest.fn(async () => ({ charged: true }));
    const machine = new OrderStateMachine();
    const { bus, broker } = await startWithTopology({
      instances: new Map<unknown, unknown>([
        [PingConsumer, new PingConsumer()],
        [OrderStateMachine, machine],
        [IPublishEndpoint, { Send: send, Publish: jest.fn() }],
      ]),
    });
    const channel = broker.channels.find((c) => c.consumers.has('order-saga') && !c.closed)!;
    channel.deliver('order-saga', { messageType: 'message:linkadz:OrderSubmitted', message: { OrderId: 'o-1' }, headers: {} });
    await eventually(() => channel.acks.length === 1);

    expect(send).toHaveBeenCalledTimes(1);
    expect((send.mock.calls[0] as any[])[0]).toMatchObject({ OrderId: 'o-1' });
    const saved = await (machine as any).repository.findByCorrelationId('o-1');
    expect(saved.CurrentState).toBe('Charging');
    expect(broker.published.some((p) => p.routingKey === 'order-saga_error')).toBe(false);
    await bus.close();
  });

  it('keeps exactly one consumer on a queue after repeated channel losses', async () => {
    const { bus, broker } = await startWithTopology();
    for (let i = 0; i < 3; i++) {
      broker.channels.find((c) => c.consumers.has('ping') && !c.closed)?.serverClose(406, `PRECONDITION_FAILED - loss ${i}`);
      await sleep(i === 0 ? 5 : 30);
    }
    await eventually(() => bus.health().consumers.ping === 'consuming', 1500);
    await sleep(150);
    expect(broker.channels.filter((c) => c.consumers.has('ping') && !c.closed)).toHaveLength(1);
    await bus.close();
  });

  it('can be closed twice and rejects publishes afterwards', async () => {
    const { bus } = await startBroker({ messages: { OrderPlaced } });
    await bus.close();
    await bus.close();
    await expect(bus.publish(new OrderPlaced())).rejects.toThrow('[RabbitMQ] Not connected to broker');
  });
});

describe('BusTransitBrokerRabbitMqFactory shutdown and redelivery recovery', () => {
  class GatedPingConsumer extends BusTransitConsumer<PingMessage> {
    started = 0;
    release!: () => void;
    readonly gate = new Promise<void>((resolve) => (this.release = resolve));
    constructor(private readonly fail = false) {
      super(PingMessage);
    }
    async Consume(ctx, context) {
      await super.Consume(ctx, context);
      this.started++;
      await this.gate;
      if (this.fail) throw new Error('downstream gone');
    }
  }
  class FailingPingConsumer extends BusTransitConsumer<PingMessage> {
    constructor() {
      super(PingMessage);
    }
    async Consume(ctx, context) {
      await super.Consume(ctx, context);
      throw new Error('boom');
    }
  }
  const liveConsumerChannel = (broker: ReturnType<typeof createFakeBroker>) => broker.channels.find((c) => c.consumers.has('ping') && !c.closed);

  it('waits for the drain once when stopConsuming() is followed by close()', async () => {
    const consumer = new GatedPingConsumer();
    const { bus, broker } = await startBroker({
      consumers: { GatedPingConsumer },
      endpoints: { ping: pingEndpoint(GatedPingConsumer) },
      instances: new Map<unknown, unknown>([[GatedPingConsumer, consumer]]),
    });
    await eventually(() => bus.health().consumers.ping === 'consuming');
    liveConsumerChannel(broker)!.deliver('ping', { message: { text: 'stuck' }, headers: {} });
    await eventually(() => consumer.started === 1);

    const started = Date.now();
    await bus.stopConsuming(); // shutdownTimeoutMs is 300 in the fixture
    await bus.close();
    const total = Date.now() - started;
    expect(total).toBeGreaterThanOrEqual(280);
    expect(total).toBeLessThan(500);
    expect(mainConnections(broker)[0].closed).toBe(true);
    consumer.release();
  });

  it('hands a message that fails during shutdown back to its queue instead of parking it', async () => {
    const consumer = new GatedPingConsumer(true);
    const { bus, broker } = await startBroker({
      consumers: { GatedPingConsumer },
      endpoints: { ping: pingEndpoint(GatedPingConsumer) },
      instances: new Map<unknown, unknown>([[GatedPingConsumer, consumer]]),
    });
    await eventually(() => bus.health().consumers.ping === 'consuming');
    const channel = liveConsumerChannel(broker)!;
    const msg = channel.deliver('ping', { message: { text: 'needs B' }, headers: {} });
    await eventually(() => consumer.started === 1);

    const stopping = bus.stopConsuming();
    consumer.release(); // the handler fails after shutdown began, e.g. its Send timed out
    await stopping;
    expect(channel.nacks).toEqual([{ message: msg, requeue: true }]);
    expect(channel.acks).toHaveLength(0);
    expect(broker.published.filter((p) => p.routingKey === 'ping_error')).toHaveLength(0);
    await bus.close();
  });

  it('re-creates a deleted delay exchange and its binding when the consumer restarts', async () => {
    const delayExchange = 'linkadz:delayed.exchange.ping';
    const { bus, broker } = await startBroker({
      consumers: { FailingPingConsumer },
      endpoints: { ping: pingEndpoint(FailingPingConsumer, true) },
      instances: new Map<unknown, unknown>([[FailingPingConsumer, new FailingPingConsumer()]]),
    });
    await eventually(() => bus.health().consumers.ping === 'consuming');
    expect(bus.isRedeliveryEnabledForQueue('ping')).toBe(true);

    // A failing message goes to the delay exchange while it exists.
    const first = liveConsumerChannel(broker)!;
    first.deliver('ping', { message: { text: 'a' }, headers: {} });
    await eventually(() => first.acks.length === 1);
    expect(broker.published.filter((p) => p.exchange === delayExchange)).toHaveLength(1);

    // An operator deletes it: the next failing message is kept in the error queue, and nothing is published to the
    // missing exchange, so the shared producer channel never meets a 404.
    broker.exchanges.delete(delayExchange);
    broker.bindings = broker.bindings.filter((b) => b.source !== delayExchange);
    const closesBefore = broker.serverCloses.length;
    first.deliver('ping', { message: { text: 'b' }, headers: {} });
    await eventually(() => first.acks.length === 2);
    expect(broker.published.filter((p) => p.routingKey === 'ping_error')).toHaveLength(1);
    expect(broker.published.filter((p) => p.exchange === delayExchange)).toHaveLength(1); // still only 'a'
    expect(broker.channels.filter((c) => c.confirm).every((c) => !c.closed)).toBe(true);
    const producerIds = new Set(broker.channels.filter((c) => c.confirm).map((c) => c.id));
    expect(broker.serverCloses.slice(closesBefore).filter((c) => producerIds.has(c.channel))).toHaveLength(0);

    // The consumer channel is lost; the restart re-creates the exchange and the binding, and consumes again.
    const closesBeforeRestart = broker.serverCloses.length;
    first.serverClose(406, 'PRECONDITION_FAILED - unknown delivery tag 1');
    await eventually(() => bus.health().consumers.ping === 'consuming' && liveConsumerChannel(broker) !== undefined);
    expect(broker.exchanges.get(delayExchange)).toBe('x-delayed-message');
    expect(broker.bindings).toContainEqual({ source: delayExchange, dest: 'queue:ping' });
    expect(bus.isRedeliveryEnabledForQueue('ping')).toBe(true);
    expect(broker.serverCloses.slice(closesBeforeRestart).filter((c) => /NOT_FOUND/.test(c.text))).toHaveLength(0);

    const second = liveConsumerChannel(broker)!;
    second.deliver('ping', { message: { text: 'd' }, headers: {} });
    await eventually(() => second.acks.length === 1);
    const delayed = broker.published.filter((p) => p.exchange === delayExchange);
    expect(delayed.map((p) => p.content.message.text)).toEqual(['a', 'd']);
    await bus.close();
  });

  it('declares a deleted queue exchange again when the consumer restarts', async () => {
    const { bus, broker } = await startBroker({
      consumers: { FailingPingConsumer },
      endpoints: { ping: pingEndpoint(FailingPingConsumer) },
      instances: new Map<unknown, unknown>([[FailingPingConsumer, new FailingPingConsumer()]]),
    });
    await eventually(() => bus.health().consumers.ping === 'consuming');
    broker.exchanges.delete('linkadz:ping');
    liveConsumerChannel(broker)!.serverClose(406, 'PRECONDITION_FAILED - unknown delivery tag 1');
    await eventually(() => bus.health().consumers.ping === 'consuming' && liveConsumerChannel(broker) !== undefined);
    expect(broker.exchanges.get('linkadz:ping')).toBe('fanout');
    await bus.close();
  });
  it('starts no consumer when stopConsuming() ran while the first connection setup was still running', async () => {
    let handled = 0;
    class CountingConsumer extends BusTransitConsumer<PingMessage> {
      constructor() {
        super(PingMessage);
      }
      async Consume(ctx, context) {
        await super.Consume(ctx, context);
        handled++;
      }
    }
    const broker = createFakeBroker();
    const { bus } = await startBroker({
      broker,
      start: false,
      consumers: { CountingConsumer },
      endpoints: { ping: pingEndpoint(CountingConsumer) },
      instances: new Map<unknown, unknown>([[CountingConsumer, new CountingConsumer()]]),
    });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    (amqp.connect as unknown as jest.Mock).mockImplementation(async (_url: unknown, socketOptions?: any) => {
      await gate; // the broker is slow to answer at boot, and SIGTERM arrives meanwhile
      return new FakeConnection(broker, socketOptions?.clientProperties?.connection_name ?? '');
    });
    const starting = bus.start();
    await sleep(10);
    await bus.stopConsuming();
    release();
    await starting;
    await sleep(100);
    expect(bus.health().consumers).toEqual({});
    expect(broker.channels.some((c) => c.consumers.size > 0)).toBe(false);
    expect(handled).toBe(0);
    await bus.close();
  });

  it('retries the redelivery setup once when the shared topology channel was closed by someone else', async () => {
    const bind = jest.spyOn(Publisher.prototype, 'bindQueue').mockRejectedValueOnce(new Error('Channel ended, no reply will be forthcoming'));
    try {
      const { bus, broker } = await startBroker({
        consumers: { FailingPingConsumer },
        endpoints: { ping: pingEndpoint(FailingPingConsumer, true) },
        instances: new Map<unknown, unknown>([[FailingPingConsumer, new FailingPingConsumer()]]),
      });
      await eventually(() => bus.health().consumers.ping === 'consuming');
      expect(bind).toHaveBeenCalledTimes(2);
      expect(bus.isRedeliveryEnabledForQueue('ping')).toBe(true);
      expect(broker.bindings).toContainEqual({ source: 'linkadz:delayed.exchange.ping', dest: 'queue:ping' });
      await bus.close();
    } finally {
      bind.mockRestore();
    }
  });

  it('does not retry the redelivery setup when the broker refused it', async () => {
    const refusal: any = new Error('Operation failed: 406 (PRECONDITION-FAILED)');
    refusal.code = 406;
    const bind = jest.spyOn(Publisher.prototype, 'bindQueue').mockRejectedValueOnce(refusal);
    try {
      const { bus } = await startBroker({
        consumers: { FailingPingConsumer },
        endpoints: { ping: pingEndpoint(FailingPingConsumer, true) },
        instances: new Map<unknown, unknown>([[FailingPingConsumer, new FailingPingConsumer()]]),
      });
      await eventually(() => bus.health().consumers.ping === 'consuming');
      expect(bind).toHaveBeenCalledTimes(1);
      expect(bus.isRedeliveryEnabledForQueue('ping')).toBe(false);
      await bus.close();
    } finally {
      bind.mockRestore();
    }
  });
});
