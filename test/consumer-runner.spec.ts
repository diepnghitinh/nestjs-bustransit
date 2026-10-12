jest.mock('amqplib', () => ({ connect: jest.fn() }));
import { Logger } from '@nestjs/common';
import { ConnectionManager } from '../lib/factories/brokers/rabbitmq/connection-manager';
import { ConsumerRunner } from '../lib/factories/brokers/rabbitmq/consumer-runner';
import { resolveReliability } from '../lib/factories/brokers/rabbitmq/reliability-options';
import { eventually, mockConnect, sleep } from './support/broker-fixture';
import { createFakeBroker, FakeBroker } from './support/fake-amqp';

const reliability = resolveReliability({ reconnectDelayMs: 20, consumerRestartMaxDelayMs: 80, readyTimeoutMs: 200 });

let wrapConsumeOnce = false;

async function run(options: { prepare?: (broker: FakeBroker) => void; channelPrepare?: (channel: any) => Promise<void>; handle?: jest.Mock; wrapConsume?: boolean; start?: boolean } = {}) {
  const broker = createFakeBroker();
  options.prepare?.(broker);
  mockConnect(broker);
  const handle = options.handle ?? jest.fn(async (channel: any, message: any) => channel.ack(message));
  let runner!: ConsumerRunner;
  const manager = new ConnectionManager({ hostname: 'rmq' }, 'linkadz', reliability, () => runner.start());
  runner = new ConsumerRunner(
    {
      queue: 'ping',
      prefetch: 5,
      prepare: async (channel: any) => {
        if (options.channelPrepare) {
          await options.channelPrepare(channel);
        } else {
          await channel.assertQueue('ping', { durable: true });
        }
        if (options.wrapConsume && wrapConsumeOnce) {
          wrapConsumeOnce = false;
          let first = true;
          const original = channel.consume.bind(channel);
          channel.consume = async (...args: any[]) => {
            const result = await original(...args);
            if (first) {
              first = false;
              channel.serverClose(406, 'PRECONDITION_FAILED - test');
            }
            return result;
          };
        }
      },
      handle,
    },
    manager,
    reliability,
  );
  if (options.start !== false) await manager.start();
  return { broker, manager, runner, handle };
}

const pingChannel = (broker: FakeBroker) => broker.channels.find((c) => c.consumers.has('ping') && !c.closed);

describe('ConsumerRunner', () => {
  it('consumes and dispatches messages', async () => {
    const { broker, manager, runner, handle } = await run();
    expect(runner.status).toBe('consuming');
    pingChannel(broker)!.deliver('ping', { message: { text: 'hi' } });
    await eventually(() => handle.mock.calls.length === 1);
    await manager.close();
  });

  it('restarts after the broker closes its channel', async () => {
    const { broker, manager, runner, handle } = await run();
    const first = pingChannel(broker)!;
    first.serverClose(406, 'PRECONDITION_FAILED - unknown delivery tag 1');
    expect(runner.status).toBe('restarting');

    await eventually(() => runner.status === 'consuming');
    const second = pingChannel(broker)!;
    expect(second).not.toBe(first);
    second.deliver('ping', { message: { text: 'after restart' } });
    await eventually(() => handle.mock.calls.length === 1);
    const openPingChannels = broker.channels.filter((c) => c.consumers.has('ping') && !c.closed);
    expect(openPingChannels).toHaveLength(1);
    await manager.close();
  });

  it('keeps retrying with a growing delay while the queue cannot be declared, then recovers', async () => {
    const { broker, manager, runner } = await run({ prepare: (b) => b.queueConflicts.add('ping') });
    expect(runner.status).toBe('restarting');
    await sleep(150);
    const attempts = broker.serverCloses.length;
    expect(attempts).toBeGreaterThanOrEqual(2);
    expect(attempts).toBeLessThanOrEqual(5);

    broker.queueConflicts.delete('ping');
    await eventually(() => runner.status === 'consuming', 1000);
    await manager.close();
  });

  it('restarts when the broker cancels the consumer', async () => {
    const { broker, manager, runner } = await run();
    pingChannel(broker)!.cancelFromBroker('ping');
    await eventually(() => runner.status === 'restarting');
    await eventually(() => runner.status === 'consuming');
    expect(pingChannel(broker)).toBeDefined();
    await manager.close();
  });

  it('stops taking messages and waits for the ones in progress on stop()', async () => {
    const handle = jest.fn(async (channel: any, message: any) => {
      await sleep(60);
      channel.ack(message);
    });
    const { broker, manager, runner } = await run({ handle });
    const channel = pingChannel(broker)!;
    channel.deliver('ping', { message: { text: 'slow' } });

    await runner.stop(500);
    expect(channel.acks).toHaveLength(1);
    expect(channel.consumers.has('ping')).toBe(false);
    expect(runner.status).toBe('stopped');
    await manager.close();
  });

  it('gives up waiting after the shutdown timeout', async () => {
    const handle = jest.fn(() => new Promise<void>(() => undefined));
    const { broker, manager, runner } = await run({ handle });
    pingChannel(broker)!.deliver('ping', { message: { text: 'stuck' } });
    const started = Date.now();
    await runner.stop(50);
    expect(Date.now() - started).toBeLessThan(200);
    await manager.close();
  });

  it('drains only once when stop() is called twice', async () => {
    const handle = jest.fn(() => new Promise<void>(() => undefined));
    const { broker, manager, runner } = await run({ handle });
    const channel = pingChannel(broker)!;
    const cancel = jest.spyOn(channel, 'cancel');
    channel.deliver('ping', { message: { text: 'stuck' } });
    const started = Date.now();
    const first = runner.stop(100);
    const second = runner.stop(100);
    expect(second).toBe(first);
    await first;
    await runner.stop(100);
    expect(Date.now() - started).toBeLessThan(180);
    expect(cancel).toHaveBeenCalledTimes(1);
    await manager.close();
  });

  it('starts again on the new connection after a reconnect', async () => {
    const { broker, manager, runner } = await run();
    broker.connections[0].drop();
    expect(runner.status).toBe('stopped');
    await eventually(() => runner.status === 'consuming');
    expect(pingChannel(broker)?.connection).toBe(broker.connections[1]);
    await manager.close();
  });
});

describe('ConsumerRunner edge cases', () => {
  it('survives a handler that throws synchronously', async () => {
    const { broker, manager } = await run({ handle: jest.fn(() => { throw new Error('sync boom'); }) });
    expect(() => pingChannel(broker)!.deliver('ping', { message: {} })).not.toThrow();
    await sleep(10);
    await manager.close();
  });

  it('hands back a message delivered after stop() began instead of processing it', async () => {
    const handle = jest.fn(async (channel: any, message: any) => {
      await sleep(40);
      channel.ack(message);
    });
    const { broker, manager, runner } = await run({ handle });
    const channel = pingChannel(broker)!;
    const deliverRaw = channel.consumers.get('ping')!;
    channel.deliver('ping', { message: { n: 1 } });
    const stopping = runner.stop(500);
    deliverRaw({ content: Buffer.from('{"message":{}}'), fields: { deliveryTag: 99 }, properties: { headers: {} } });
    await stopping;
    expect(handle).toHaveBeenCalledTimes(1);
    expect(channel.nacks.map((n) => n.message.fields.deliveryTag)).toEqual([99]);
    expect(channel.nacks[0].requeue).toBe(true);
    await manager.close();
  });

  it('can be stopped twice', async () => {
    const { manager, runner } = await run();
    await runner.stop(50);
    await runner.stop(50);
    expect(runner.status).toBe('stopped');
    await manager.close();
  });

  it('does not report consuming when the broker closes the channel right as the consumer starts', async () => {
    wrapConsumeOnce = true;
    const { broker, manager, runner } = await run({ wrapConsume: true });
    await eventually(() => runner.status === 'consuming');
    const openPingChannels = broker.channels.filter((c) => c.consumers.has('ping') && !c.closed);
    expect(openPingChannels).toHaveLength(1);
    await manager.close();
  });

  it('reports stopped, without an error, when stop() runs during an in-flight start', async () => {
    const errorSpy = jest.spyOn(Logger, 'error');
    let resolveStart: () => void;
    const startPromise = new Promise<void>((resolve) => {
      resolveStart = resolve;
    });

    const { manager, runner } = await run({
      channelPrepare: async () => {
        await startPromise;
      },
      start: false,
    });

    const starting = manager.start();
    await sleep(10); // Allow manager.start() to trigger runner.start()
    await eventually(() => runner.status === 'starting', 500);
    await runner.stop(50);
    resolveStart();
    await starting;

    expect(runner.status).toBe('stopped');
    const errorCalls = errorSpy.mock.calls.filter((call) =>
      String(call[0]).includes('Could not start the consumer'),
    );
    expect(errorCalls).toHaveLength(0);
    errorSpy.mockRestore();
    await manager.close();
  });

  it('counts a cancel that never answers against the drain budget', async () => {
    const { broker, manager, runner } = await run();
    const channel = pingChannel(broker)! as any;
    channel.cancel = jest.fn(() => new Promise(() => undefined)); // the broker stopped answering
    const startedAt = Date.now();
    await runner.stop(200);
    expect(Date.now() - startedAt).toBeLessThan(1000);
    await manager.close();
  });

  it('lets the in-flight wait share the drain deadline with a slow cancel', async () => {
    const handle = jest.fn(() => new Promise(() => undefined)); // never finishes
    const { broker, manager, runner } = await run({ handle });
    const channel = pingChannel(broker)! as any;
    channel.cancel = jest.fn(() => sleep(250));
    channel.deliver('ping', { message: { n: 1 } });
    await eventually(() => handle.mock.calls.length === 1);
    const startedAt = Date.now();
    await runner.stop(300);
    // cancel 250 ms + the remaining ~50 ms; a fresh 300 ms in-flight wait would give ~550 ms
    expect(Date.now() - startedAt).toBeLessThan(450);
    await manager.close();
  });
});
