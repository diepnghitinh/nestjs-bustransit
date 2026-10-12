jest.mock('amqplib', () => ({ connect: jest.fn() }));
import { ConnectionManager } from '../lib/factories/brokers/rabbitmq/connection-manager';
import { resolveReliability } from '../lib/factories/brokers/rabbitmq/reliability-options';
import { RequestClient } from '../lib/factories/brokers/rabbitmq/request-client';
import { addMilliseconds } from '../lib/utils/date';
import { eventually, mockConnect } from './support/broker-fixture';
import { createFakeBroker, FakeBroker } from './support/fake-amqp';

const reliability = resolveReliability({ reconnectDelayMs: 20, readyTimeoutMs: 100, sendTimeoutMs: 300 });

async function connected(queues: string[] = []) {
  const broker = createFakeBroker();
  queues.forEach((q) => broker.queues.add(q));
  mockConnect(broker);
  const manager = new ConnectionManager({ hostname: 'rmq' }, 'linkadz', reliability, async () => undefined);
  await manager.start();
  return { broker, manager, client: new RequestClient(manager, reliability) };
}

const replyChannel = (broker: FakeBroker) => broker.channels.find((c) => c.consumers.has('amq.rabbitmq.reply-to'));

describe('RequestClient', () => {
  it('returns the reply and closes its temporary channel', async () => {
    const { broker, manager, client } = await connected(['ping']);
    const pending = client.send('ping', { message: { text: 'hi' } }, 'Ping');
    await eventually(() => broker.published.some((p) => p.routingKey === 'ping'));

    const sent = broker.published.find((p) => p.routingKey === 'ping')!;
    const temp = replyChannel(broker)!;
    temp.deliver('amq.rabbitmq.reply-to', { ok: 1 }, { correlationId: sent.options.correlationId });

    await expect(pending).resolves.toEqual({ ok: 1 });
    expect(temp.closed).toBe(true);
    await manager.close();
  });

  it('fails fast when no queue has that name', async () => {
    const { broker, manager, client } = await connected();
    const started = Date.now();
    await expect(client.send('ping', {}, 'Ping')).rejects.toThrow(
      "[RabbitMQ] Send failed: no queue named 'ping'. Check the endpoint name configured for Ping.",
    );
    expect(Date.now() - started).toBeLessThan(150);
    expect(replyChannel(broker)?.closed).toBe(true);
    await manager.close();
  });

  it('times out without a reply and still closes the channel', async () => {
    const { broker, manager, client } = await connected(['ping']);
    await expect(client.send('ping', {}, 'Ping')).rejects.toThrow('No response received after 300ms');
    expect(replyChannel(broker)?.closed).toBe(true);
    await manager.close();
  });
});

describe('addMilliseconds', () => {
  it('adds milliseconds', () => {
    const start = new Date('2026-10-11T00:00:00.000Z');
    expect(addMilliseconds(start, 10000).toISOString()).toBe('2026-10-11T00:00:10.000Z');
  });
});

describe('RequestClient edge cases', () => {
  it('ignores replies that belong to other requests', async () => {
    const { broker, manager, client } = await connected(['ping']);
    const pending = client.send('ping', {}, 'Ping');
    await eventually(() => broker.published.length === 1);
    const temp = replyChannel(broker)!;
    temp.deliver('amq.rabbitmq.reply-to', { other: true }, { correlationId: 'someone-else' });
    temp.deliver('amq.rabbitmq.reply-to', { mine: true }, { correlationId: broker.published[0].options.correlationId });
    await expect(pending).resolves.toEqual({ mine: true });
    await manager.close();
  });

  it('rejects a reply that is not JSON', async () => {
    const { broker, manager, client } = await connected(['ping']);
    const pending = client.send('ping', {}, 'Ping');
    await eventually(() => broker.published.length === 1);
    const started = Date.now();
    replyChannel(broker)!.deliver('amq.rabbitmq.reply-to', 'not json', { correlationId: broker.published[0].options.correlationId });
    await expect(pending).rejects.toThrow(SyntaxError);
    expect(Date.now() - started).toBeLessThan(150);
    await manager.close();
  });

  it('fails fast when the connection drops while waiting for the reply', async () => {
    const { broker, manager, client } = await connected(['ping']);
    const pending = client.send('ping', {}, 'Ping');
    await eventually(() => broker.published.length === 1);
    const started = Date.now();
    broker.connections[0].drop();
    await expect(pending).rejects.toThrow('the channel closed before a reply arrived');
    expect(Date.now() - started).toBeLessThan(150);
    await manager.close();
  });
});
