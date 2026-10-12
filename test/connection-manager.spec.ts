jest.mock('amqplib', () => ({ connect: jest.fn() }));
import { Logger } from '@nestjs/common';
import * as amqp from 'amqplib';
import { CLOSE_TIMEOUT_MS, CLOSE_WAIT_FOR_START_MS, ConnectionManager } from '../lib/factories/brokers/rabbitmq/connection-manager';
import { resolveReliability } from '../lib/factories/brokers/rabbitmq/reliability-options';
import { eventually, mockConnect, sleep } from './support/broker-fixture';
import { createFakeBroker, FakeConnection, mainConnections } from './support/fake-amqp';

const reliability = resolveReliability({ reconnectDelayMs: 20, readyTimeoutMs: 100 });

function create(setup: jest.Mock = jest.fn(async () => undefined)) {
  const broker = createFakeBroker();
  mockConnect(broker);
  const manager = new ConnectionManager({ hostname: 'rmq' }, 'linkadz', reliability, setup);
  return { broker, manager, setup };
}

describe('ConnectionManager', () => {
  it('becomes ready after setup ran on the new connection', async () => {
    const { manager, setup, broker } = create();
    await manager.start();
    await expect(manager.whenReady()).resolves.toBeUndefined();
    expect(manager.isConnected).toBe(true);
    expect(setup).toHaveBeenCalledWith(broker.connections[0]);
    await manager.close();
  });

  it('fails whenReady with a clear message while the broker is down', async () => {
    const { manager } = create();
    (amqp.connect as unknown as jest.Mock).mockRejectedValue(new Error('connect ECONNREFUSED'));
    await manager.start();
    await expect(manager.whenReady()).rejects.toThrow('[RabbitMQ] Not connected to broker after 100ms');
    await manager.close();
  });

  it('reconnects after the connection drops and runs setup again', async () => {
    const { manager, setup, broker } = create();
    const disconnected = jest.fn();
    manager.onDisconnected(disconnected);
    await manager.start();
    broker.connections[0].drop();
    expect(manager.isConnected).toBe(false);
    expect(disconnected).toHaveBeenCalledTimes(1);

    await expect(manager.whenReady()).resolves.toBeUndefined();
    expect(setup).toHaveBeenCalledTimes(2);
    expect(mainConnections(broker)).toHaveLength(2);
    await manager.close();
  });

  it('survives an error event on the connection', async () => {
    const { manager, broker } = create();
    await manager.start();
    expect(() => broker.connections[0].emit('error', new Error('heartbeat timeout'))).not.toThrow();
    await manager.close();
  });

  it('logs a connection error at ERROR, but not the one caused by our own drop while shutting down', async () => {
    const error = jest.spyOn(Logger, 'error').mockImplementation(() => undefined);
    try {
      const { manager, broker } = create();
      await manager.start();
      broker.connections[0].emit('error', new Error('heartbeat timeout'));
      expect(error).toHaveBeenCalledWith(expect.stringContaining('Connection error: heartbeat timeout'));
      error.mockClear();
      const closing = manager.close();
      broker.connections[0].emit('error', new Error('[RabbitMQ] The broker did not answer the close; connection dropped'));
      await closing;
      expect(error).not.toHaveBeenCalled();
    } finally {
      error.mockRestore();
    }
  });

  it('closes a half-open connection when setup fails, then retries', async () => {
    const setup = jest.fn().mockRejectedValueOnce(new Error('setup broke')).mockResolvedValue(undefined);
    const { manager, broker } = create(setup);
    await manager.start();
    expect(broker.connections[0].closed).toBe(true);
    await expect(manager.whenReady()).resolves.toBeUndefined();
    expect(broker.connections).toHaveLength(2);
    await manager.close();
  });

  it('closes channels and connection on close() and never reconnects', async () => {
    const { manager, broker } = create();
    await manager.start();
    const channel = await manager.channels.getOrCreate('_producer', () => manager.current!.createConfirmChannel());
    await manager.close();
    await sleep(60);
    expect((channel as any).closed).toBe(true);
    expect(broker.connections[0].closed).toBe(true);
    expect(broker.connections).toHaveLength(1);
  });

  it('tracks when the broker blocks and unblocks publishers', async () => {
    const { manager, broker } = create();
    await manager.start();
    broker.connections[0].emit('blocked', 'low on memory');
    expect(manager.isBlocked).toBe(true);
    broker.connections[0].emit('unblocked');
    expect(manager.isBlocked).toBe(false);
    await manager.close();
  });

  it('reports channels the broker closed', async () => {
    const { manager } = create();
    const lost = jest.fn();
    manager.onChannelLost(lost);
    await manager.start();
    const channel: any = await manager.channels.getOrCreate('_producer', () => manager.current!.createConfirmChannel());
    channel.on('error', () => undefined);
    channel.serverClose(406, 'PRECONDITION_FAILED - test');
    await eventually(() => lost.mock.calls.length === 1);
    expect(lost).toHaveBeenCalledWith('_producer');
    await manager.close();
  });
});

describe('ConnectionManager edge cases', () => {
  it('opens one connection when start() is called concurrently', async () => {
    const { manager, broker } = create();
    await Promise.all([manager.start(), manager.start(), manager.start()]);
    expect(broker.connections).toHaveLength(1);
    await manager.close();
  });

  it('leaves nothing open when close() is called while connecting', async () => {
    const broker = createFakeBroker();
    let release!: () => void;
    (amqp.connect as unknown as jest.Mock).mockImplementation(
      () => new Promise((resolve) => (release = () => resolve(new FakeConnection(broker, 'linkadz')))),
    );
    const manager = new ConnectionManager({ hostname: 'rmq' }, 'linkadz', reliability, async () => undefined);
    const starting = manager.start();
    const closing = manager.close();
    release();
    await starting;
    await closing;
    expect(broker.connections[0].closed).toBe(true);
    expect(manager.isConnected).toBe(false);
  });

  it('is not ready when the connection dies during setup, and recovers on the next one', async () => {
    let calls = 0;
    const { manager, broker } = create(
      jest.fn(async (connection: any) => {
        calls++;
        if (calls === 1) connection.drop(); // setup itself does not throw
      }),
    );
    await manager.start();
    expect(manager.isConnected).toBe(false);
    await expect(manager.whenReady()).resolves.toBeUndefined();
    expect(calls).toBe(2);
    expect(manager.current).toBe(mainConnections(broker)[1]);
    await manager.close();
  });

  it('reconnects when the connection dies during a setup that outlasts the reconnect delay', async () => {
    let calls = 0;
    const { manager, broker } = create(
      jest.fn(async (connection: any) => {
        calls++;
        if (calls === 1) {
          connection.drop();
          await sleep(60);
        }
      }),
    );
    await manager.start();
    await expect(manager.whenReady()).resolves.toBeUndefined();
    expect(calls).toBe(2);
    await manager.close();
  });

  it('waits for an in-flight start() before close() resolves', async () => {
    const broker = createFakeBroker();
    let release!: () => void;
    (amqp.connect as unknown as jest.Mock).mockImplementation(
      () => new Promise((resolve) => (release = () => resolve(new FakeConnection(broker, 'linkadz')))),
    );
    const manager = new ConnectionManager({ hostname: 'rmq' }, 'linkadz', reliability, async () => undefined);
    void manager.start();
    const closing = manager.close();
    release();
    await closing;
    expect(broker.connections[0].closed).toBe(true);
  });

  it('close() waits for the real start even after a duplicate start() call', async () => {
    const broker = createFakeBroker();
    let release!: () => void;
    (amqp.connect as unknown as jest.Mock).mockImplementation(
      () => new Promise((resolve) => (release = () => resolve(new FakeConnection(broker, 'linkadz')))),
    );
    const manager = new ConnectionManager({ hostname: 'rmq' }, 'linkadz', reliability, async () => undefined);
    void manager.start();
    void manager.start();
    const closing = manager.close();
    release();
    await closing;
    expect(broker.connections[0].closed).toBe(true);
    expect(broker.connections).toHaveLength(1);
  });

  it('never rejects start() when a listener throws', async () => {
    const { manager } = create();
    (amqp.connect as unknown as jest.Mock).mockRejectedValue(new Error('connect failed'));
    manager.onDisconnected(() => {
      throw new Error('listener boom');
    });
    await expect(manager.start()).resolves.toBeUndefined();
    await manager.close();
  });

  it('gives up closing a connection the broker no longer answers and destroys its socket', async () => {
    const { broker, manager } = create();
    await manager.start();
    const connection = broker.connections[0] as any;
    const destroy = jest.fn();
    connection.connection = { stream: { destroy } };
    connection.close = jest.fn(() => new Promise(() => undefined));
    const errorListeners = connection.listenerCount('error');
    const startedAt = Date.now();
    await manager.close();
    expect(Date.now() - startedAt).toBeLessThan(CLOSE_TIMEOUT_MS + 1000);
    expect(destroy).toHaveBeenCalledWith(expect.any(Error)); // a plain destroy() is invisible to amqplib
    expect(connection.listenerCount('error')).toBe(errorListeners + 1); // closeOrDestroy's own absorber
  }, CLOSE_TIMEOUT_MS + 5000);

  it('keeps a frozen close plus a start still in setup within one CLOSE_TIMEOUT_MS', async () => {
    const broker = createFakeBroker();
    const destroy = jest.fn();
    (amqp.connect as unknown as jest.Mock).mockImplementation(async () => {
      const connection = new FakeConnection(broker, 'linkadz') as any;
      connection.createChannel = jest.fn(() => new Promise(() => undefined)); // setup never finishes
      connection.createConfirmChannel = connection.createChannel;
      connection.close = jest.fn(() => new Promise(() => undefined));
      connection.connection = { stream: { destroy } };
      return connection;
    });
    const manager = new ConnectionManager(
      { hostname: 'rmq' } as any,
      'linkadz',
      reliability,
      async () => new Promise<void>(() => undefined),
    );
    void manager.start().catch(() => undefined);
    await sleep(20);
    const startedAt = Date.now();
    await manager.close();
    expect(Date.now() - startedAt).toBeLessThan(CLOSE_TIMEOUT_MS + 1000);
    expect(destroy).toHaveBeenCalledWith(expect.any(Error));
  }, CLOSE_TIMEOUT_MS + 5000);

  it('bounds the TCP connect by readyTimeoutMs', async () => {
    const { manager } = create();
    (amqp.connect as unknown as jest.Mock).mockClear();
    await manager.start();
    expect(amqp.connect).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ timeout: reliability.readyTimeoutMs }),
    );
    await manager.close();
  });

  it('does not wait longer than CLOSE_WAIT_FOR_START_MS for a connect that never answers', async () => {
    const broker = createFakeBroker();
    let release!: () => void;
    (amqp.connect as unknown as jest.Mock).mockImplementation(
      () => new Promise((resolve) => (release = () => resolve(new FakeConnection(broker, 'linkadz')))),
    );
    const manager = new ConnectionManager({ hostname: 'rmq' }, 'linkadz', reliability, async () => undefined);
    void manager.start();
    const startedAt = Date.now();
    await manager.close();
    const elapsed = Date.now() - startedAt;
    expect(elapsed).toBeGreaterThanOrEqual(CLOSE_WAIT_FOR_START_MS - 50);
    expect(elapsed).toBeLessThan(CLOSE_WAIT_FOR_START_MS + 500);

    // The connection opens after close() returned: it is closed at once and nothing reconnects.
    release();
    await eventually(() => broker.connections[0].closed);
    await sleep(reliability.reconnectDelayMs * 3);
    expect(broker.connections).toHaveLength(1);
    expect(manager.isConnected).toBe(false);
  }, CLOSE_WAIT_FOR_START_MS + 5000);

  it('retries after a connect that times out while not shutting down', async () => {
    const broker = createFakeBroker();
    const connect = amqp.connect as unknown as jest.Mock;
    connect.mockClear(); // mocks are not reset between tests; count only this test's calls
    connect.mockImplementationOnce(() => Promise.reject(new Error('connect ETIMEDOUT')));
    connect.mockImplementation(async () => new FakeConnection(broker, 'linkadz'));
    const manager = new ConnectionManager({ hostname: 'rmq' }, 'linkadz', reliability, async () => undefined);
    await manager.start();
    await eventually(() => manager.isConnected);
    expect(connect).toHaveBeenCalledTimes(2);
    await manager.close();
  });
});
