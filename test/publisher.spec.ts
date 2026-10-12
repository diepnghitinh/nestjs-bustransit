jest.mock('amqplib', () => ({ connect: jest.fn() }));
import { EventEmitter } from 'events';
import { Logger } from '@nestjs/common';
import { ConnectionManager } from '../lib/factories/brokers/rabbitmq/connection-manager';
import { Publisher } from '../lib/factories/brokers/rabbitmq/publisher';
import { resolveReliability } from '../lib/factories/brokers/rabbitmq/reliability-options';
import { flush, mockConnect, sleep } from './support/broker-fixture';
import { createDeliveryHandler } from '../lib/factories/brokers/rabbitmq/delivery-pipeline';
import { createFakeBroker, FakeBroker, FakeChannel, FakeConnection } from './support/fake-amqp';

const reliability = resolveReliability({ reconnectDelayMs: 20, readyTimeoutMs: 100, publishTimeoutMs: 100 });

async function connected(prepare?: (broker: FakeBroker) => void) {
  const broker = createFakeBroker();
  prepare?.(broker);
  mockConnect(broker);
  let publisher!: Publisher;
  const manager = new ConnectionManager({ hostname: 'rmq' }, 'linkadz', reliability, () => publisher.open());
  publisher = new Publisher(manager, reliability);
  await manager.start();
  return { broker, manager, publisher };
}

const producerChannels = (broker: FakeBroker) => broker.channels.filter((c) => c.confirm);

describe('Publisher', () => {
  afterEach(() => jest.restoreAllMocks());

  it('survives the 06/10 incident: publishing a message whose exchange nobody created', async () => {
    const { broker, manager, publisher } = await connected((b) => b.exchanges.set('linkadz:SyncAnalyticsCampaignBatchMessage', 'fanout'));

    await expect(publisher.publishToExchange('linkadz:AggregateUrlAnalysisFunnelMessage', { a: 1 })).resolves.toBeUndefined();
    await expect(publisher.publishToExchange('linkadz:SyncAnalyticsCampaignBatchMessage', { b: 2 })).resolves.toBeUndefined();

    expect(broker.exchanges.get('linkadz:AggregateUrlAnalysisFunnelMessage')).toBe('fanout');
    expect(producerChannels(broker)).toHaveLength(1);
    expect(producerChannels(broker)[0].closed).toBe(false);
    await manager.close();
  });

  it('opens a new producer channel after the broker closed the old one', async () => {
    const { broker, manager, publisher } = await connected();
    await publisher.publishToExchange('linkadz:OrderPlaced', {});
    producerChannels(broker)[0].serverClose(406, 'PRECONDITION_FAILED - simulated');

    await expect(publisher.publishToExchange('linkadz:OrderPlaced', {})).resolves.toBeUndefined();
    expect(producerChannels(broker)).toHaveLength(2);
    await manager.close();
  });

  it('publishes to an exchange that already exists with other settings, as 0.3.x did', async () => {
    const { broker, manager, publisher } = await connected((b) => b.exchanges.set('linkadz:LegacyEvent', 'direct'));

    await expect(publisher.publishToExchange('linkadz:LegacyEvent', {})).resolves.toBeUndefined();
    expect(broker.exchanges.get('linkadz:LegacyEvent')).toBe('direct');
    expect(broker.asserts).not.toContain('linkadz:LegacyEvent');
    expect(producerChannels(broker)[0].closed).toBe(false);
    await manager.close();
  });

  it('declares an exchange once, and again after the broker says it is gone', async () => {
    const { broker, manager, publisher } = await connected();
    await publisher.publishToExchange('linkadz:OrderPlaced', {});
    await publisher.publishToExchange('linkadz:OrderPlaced', {});
    expect(broker.asserts.filter((n) => n === 'linkadz:OrderPlaced')).toHaveLength(1);

    broker.exchanges.delete('linkadz:OrderPlaced'); // someone deleted it on the broker
    await expect(publisher.publishToExchange('linkadz:OrderPlaced', {})).rejects.toThrow(/NOT_FOUND - no exchange 'linkadz:OrderPlaced'/);
    await expect(publisher.publishToExchange('linkadz:OrderPlaced', {})).resolves.toBeUndefined();
    expect(broker.exchanges.has('linkadz:OrderPlaced')).toBe(true);
    await manager.close();
  });

  it('rejects when the broker does not confirm in time and says the broker is blocking', async () => {
    const { broker, manager, publisher } = await connected();
    broker.holdConfirms = true;
    broker.connections[0].emit('blocked', 'low on memory');

    await expect(publisher.publishToExchange('linkadz:OrderPlaced', {})).rejects.toThrow(
      "[RabbitMQ] Publish to 'linkadz:OrderPlaced' was not confirmed within 100ms (the broker is blocking publishers)",
    );
    await manager.close();
  });

  it('opens one new channel for concurrent publishes after the old one died', async () => {
    const { broker, manager, publisher } = await connected();
    await publisher.publishToExchange('linkadz:OrderPlaced', {});
    producerChannels(broker)[0].serverClose(406, 'PRECONDITION_FAILED - simulated');

    await Promise.all(Array.from({ length: 5 }, () => publisher.publishToExchange('linkadz:OrderPlaced', {})));
    expect(producerChannels(broker)).toHaveLength(2);
    await manager.close();
  });

  it('warns when a message reaches no queue', async () => {
    const warn = jest.spyOn(Logger, 'warn').mockImplementation(() => undefined);
    const { manager, publisher } = await connected();
    await publisher.publishToExchange('linkadz:AggregateUrlAnalysisFunnelMessage', {}, { messageId: 'm-1' });
    await flush();
    expect(
      warn.mock.calls.some(([msg]) => String(msg).includes("Unroutable message m-1 to exchange 'linkadz:AggregateUrlAnalysisFunnelMessage'")),
    ).toBe(true);
    await manager.close();
  });

  it('writes to a queue through the default exchange with a confirm', async () => {
    const { broker, manager, publisher } = await connected();
    await publisher.ensureQueue('ping_error');
    await expect(publisher.publishRaw('', 'ping_error', { boom: true }, { persistent: true, mandatory: true })).resolves.toBeUndefined();
    expect(broker.published.find((p) => p.routingKey === 'ping_error')?.content).toEqual({ boom: true });
    await manager.close();
  });
});

describe('Publisher edge cases', () => {
  it('rejects a publish in flight when the connection drops, and publishes again after reconnecting', async () => {
    const { broker, manager, publisher } = await connected();
    await publisher.publishToExchange('linkadz:A', {});
    broker.holdConfirms = true;
    const inFlight = publisher.publishToExchange('linkadz:A', {});
    await sleep(5);
    broker.holdConfirms = false;
    broker.connections[0].drop();
    await expect(inFlight).rejects.toThrow(/channel closed/i);
    await expect(publisher.publishToExchange('linkadz:A', {})).resolves.toBeUndefined();
    await manager.close();
  });

  it('explains a publish lost with its connection', async () => {
    const { broker, manager, publisher } = await connected();
    await publisher.publishToExchange('linkadz:A', {});
    broker.holdConfirms = true;
    const inFlight = publisher.publishToExchange('linkadz:A', {});
    await sleep(5);
    broker.holdConfirms = false;
    broker.connections[0].drop();
    await expect(inFlight).rejects.toThrow(/connection was lost.*may or may not have been delivered/i);
    await manager.close();
  });

  it('rejects quickly after close()', async () => {
    const { manager, publisher } = await connected();
    await manager.close();
    await expect(publisher.publishToExchange('linkadz:A', {})).rejects.toThrow('[RabbitMQ] Not connected to broker');
  });

  it('rejects a body that cannot be serialized without sending anything', async () => {
    const { broker, manager, publisher } = await connected();
    const body: any = {};
    body.self = body;
    await expect(publisher.publishToExchange('linkadz:A', body)).rejects.toThrow(/circular/i);
    expect(broker.published).toHaveLength(0);
    await manager.close();
  });

  it('declares an exchange once when the first publishes run concurrently', async () => {
    const { broker, manager, publisher } = await connected();
    await Promise.all([1, 2, 3].map(() => publisher.publishToExchange('linkadz:A', {})));
    expect(broker.asserts.filter((n) => n === 'linkadz:A')).toHaveLength(1);
    await manager.close();
  });

  it('publishes concurrently to several exchanges that do not exist yet', async () => {
    const { broker, manager, publisher } = await connected();
    await Promise.all(['linkadz:A', 'linkadz:B', 'linkadz:C'].map((e) => publisher.publishToExchange(e, {})));
    expect(broker.exchanges.get('linkadz:A')).toBe('fanout');
    expect(broker.exchanges.get('linkadz:B')).toBe('fanout');
    expect(broker.exchanges.get('linkadz:C')).toBe('fanout');
    await manager.close();
  });

  it('keeps topology calls working while a publish checks a missing exchange', async () => {
    const { manager, publisher } = await connected();
    await Promise.all([
      publisher.publishToExchange('linkadz:A', {}),
      publisher.ensureQueue('q1'),
      publisher.ensureExchange('linkadz:B'),
    ]);
    await publisher.bindExchange('linkadz:B', 'linkadz:A');
    await manager.close();
  });

  describe('unroutable messages', () => {
    it('publishRaw with rejectIfUnroutable rejects when the broker returns the message, and the queue is asserted again next time', async () => {
      const { broker, manager, publisher } = await connected();
      await publisher.ensureQueue('orders_error');
      broker.queues.delete('orders_error'); // an operator deleted the queue

      await expect(
        publisher.publishRaw('', 'orders_error', { a: 1 }, { mandatory: true, rejectIfUnroutable: true }),
      ).rejects.toThrow(/returned as unroutable/);

      const asserts = jest.spyOn(FakeChannel.prototype, 'assertQueue');
      await publisher.ensureQueue('orders_error');
      expect(asserts).toHaveBeenCalledWith('orders_error', expect.anything());
      await expect(publisher.publishRaw('', 'orders_error', { a: 1 }, { mandatory: true, rejectIfUnroutable: true })).resolves.toBeUndefined();
      await manager.close();
    });

    it('publishRaw without the opt-in resolves on an unroutable message', async () => {
      const { manager, publisher } = await connected();
      await expect(publisher.publishRaw('', 'nowhere', {}, { mandatory: true })).resolves.toBeUndefined();
      await manager.close();
    });

    it('an application publish still resolves when no queue is bound, and only logs', async () => {
      const { manager, publisher } = await connected();
      const warn = jest.spyOn(Logger, 'warn').mockImplementation(() => undefined);
      await expect(publisher.publishToExchange('linkadz:NobodyListens', { a: 1 }, { messageId: 'm-9' })).resolves.toBeUndefined();
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('Unroutable message m-9'));
      await manager.close();
    });

    it('a failed message whose error queue was deleted is parked again in the re-created queue instead of being acked as lost', async () => {
      jest.spyOn(Logger, 'error').mockImplementation(() => undefined);
      jest.spyOn(Logger, 'warn').mockImplementation(() => undefined);
      const { broker, manager, publisher } = await connected();
      const handle = createDeliveryHandler({
        queue: 'orders',
        consumer: 'c',
        redeliveryEnabled: () => false,
        delayExchange: 'linkadz:delayed.exchange.orders',
        resolve: () => ({ Consume: async () => { throw new Error('boom'); } }),
        publisher,
        hostInfo: () => ({}),
        requeueDelayMs: 1,
      });
      const channel = Object.assign(new EventEmitter(), { ack: jest.fn(), nack: jest.fn(), publish: jest.fn() });
      const msg = () => ({ content: Buffer.from(JSON.stringify({ message: {} })), fields: { deliveryTag: 1 }, properties: { headers: {} } }) as any;

      await handle(channel as any, msg());
      expect(channel.ack).toHaveBeenCalledTimes(1);
      expect(broker.queues.has('orders_error')).toBe(true);

      broker.queues.delete('orders_error');
      await handle(channel as any, msg());
      // The unroutable copy was rejected (not acked as parked), the queue was re-asserted and the copy written again.
      expect(broker.queues.has('orders_error')).toBe(true);
      expect(broker.published.filter((p) => p.routingKey === 'orders_error')).toHaveLength(3);
      expect(channel.ack).toHaveBeenCalledTimes(2);
      expect(channel.nack).not.toHaveBeenCalled();
      await manager.close();
    });
  });

  describe('exchangeExists', () => {
    afterEach(() => jest.restoreAllMocks());

    it('gives up after publishTimeoutMs when the check stalls', async () => {
      const { manager, publisher } = await connected((b) => b.exchanges.set('linkadz:delayed.exchange.ping', 'x-delayed-message'));
      jest.spyOn(FakeChannel.prototype, 'checkExchange').mockImplementation(() => new Promise(() => undefined));
      const started = Date.now();
      await expect(publisher.exchangeExists('linkadz:delayed.exchange.ping')).rejects.toThrow(/Could not check exchange .* within 100ms/);
      expect(Date.now() - started).toBeLessThan(1000);
      await manager.close();
    });

    it('checks the broker every time, so a deleted exchange is noticed at once', async () => {
      const name = 'linkadz:delayed.exchange.ping';
      const { broker, manager, publisher } = await connected((b) => b.exchanges.set(name, 'x-delayed-message'));
      const check = jest.spyOn(FakeChannel.prototype, 'checkExchange');
      await expect(publisher.exchangeExists(name)).resolves.toBe(true);
      broker.exchanges.delete(name);
      await expect(publisher.exchangeExists(name)).resolves.toBe(false);
      expect(check).toHaveBeenCalledTimes(2);
      expect(producerChannels(broker)[0].closed).toBe(false);
      await manager.close();
    });

    it('drops a missing exchange from the declaration cache, so the next declaration asserts it again', async () => {
      const name = 'linkadz:delayed.exchange.ping';
      const { broker, manager, publisher } = await connected();
      await publisher.declareDelayedExchange(name);
      broker.exchanges.delete(name);
      await publisher.declareDelayedExchange(name); // still cached
      expect(broker.exchanges.has(name)).toBe(false);

      await expect(publisher.exchangeExists(name)).resolves.toBe(false);
      await publisher.declareDelayedExchange(name);
      expect(broker.exchanges.get(name)).toBe('x-delayed-message');
      await manager.close();
    });
  });

  it('gives up declaring an error queue after publishTimeoutMs, so the failed message is requeued instead of hanging', async () => {
    const { manager, publisher } = await connected();
    jest.spyOn(FakeChannel.prototype, 'assertQueue').mockImplementation(() => new Promise(() => undefined));
    const handle = createDeliveryHandler({
      queue: 'orders',
      consumer: 'c',
      redeliveryEnabled: () => false,
      delayExchange: 'linkadz:delayed.exchange.orders',
      resolve: () => ({ Consume: async () => { throw new Error('boom'); } }),
      publisher,
      hostInfo: () => ({}),
      requeueDelayMs: 1,
    });
    const channel = Object.assign(new EventEmitter(), { ack: jest.fn(), nack: jest.fn(), publish: jest.fn() });
    const started = Date.now();
    await expect(publisher.ensureQueue('orders_error')).rejects.toThrow(/Could not declare queue 'orders_error' within 100ms/);
    await handle(channel as any, { content: Buffer.from(JSON.stringify({ message: {}, headers: {} })), fields: {}, properties: { headers: {} } } as any);
    expect(Date.now() - started).toBeLessThan(600);
    expect(channel.ack).not.toHaveBeenCalled();
    expect(channel.nack).toHaveBeenCalledWith(expect.anything(), false, true);
    jest.restoreAllMocks();
    await manager.close();
  });

  it('counts opening the producer channel against publishTimeoutMs', async () => {
    const { broker, manager, publisher } = await connected();
    producerChannels(broker)[0].serverClose(404, 'NOT_FOUND - gone');
    await flush();
    const open = jest.spyOn(FakeConnection.prototype, 'createConfirmChannel').mockImplementation(() => new Promise(() => undefined));
    const started = Date.now();
    await expect(publisher.publishRaw('', 'ping', {})).rejects.toThrow(/was not confirmed within 100ms/);
    expect(Date.now() - started).toBeLessThan(400);
    open.mockRestore();
    await manager.close();
  });

  it('rejects instead of hanging when the exchange declaration stalls', async () => {
    const { manager, publisher } = await connected();
    jest.spyOn(FakeChannel.prototype, 'checkExchange').mockImplementation(() => new Promise(() => undefined));
    const started = Date.now();
    await expect(publisher.publishToExchange('linkadz:Stalled', {})).rejects.toThrow(/could not declare the exchange within 100ms/);
    expect(Date.now() - started).toBeLessThan(1000);
    await manager.close();
  });
});
