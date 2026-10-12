jest.mock('amqplib', () => ({ connect: jest.fn() }));
import { Logger } from '@nestjs/common';
import * as amqp from 'amqplib';
import { probeDelayedMessagePlugin } from '../lib/factories/brokers/rabbitmq/delayed-plugin-probe';
import { mockConnect } from './support/broker-fixture';
import { createFakeBroker, FakeConnection } from './support/fake-amqp';

describe('probeDelayedMessagePlugin', () => {
  it('returns true when the plugin is installed and leaves nothing open', async () => {
    const broker = createFakeBroker();
    mockConnect(broker);
    await expect(probeDelayedMessagePlugin({ hostname: 'rmq' }, 'linkadz', 1000)).resolves.toBe(true);
    expect(broker.connections).toHaveLength(1);
    expect(broker.connections[0].name).toBe('linkadz:probe');
    expect(broker.connections[0].closed).toBe(true);
    expect([...broker.exchanges.keys()]).toEqual([]);
  });

  it('bounds the TCP connect by the probe time limit', async () => {
    const broker = createFakeBroker();
    mockConnect(broker);
    (amqp.connect as unknown as jest.Mock).mockClear();
    await probeDelayedMessagePlugin({ hostname: 'rmq' }, 'linkadz', 1234);
    expect(amqp.connect).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ timeout: 1234 }));
  });

  it('returns false without touching the main connection when the plugin is missing', async () => {
    const broker = createFakeBroker();
    broker.delayedPlugin = false;
    const main = new FakeConnection(broker, 'linkadz');
    mockConnect(broker);
    await expect(probeDelayedMessagePlugin({ hostname: 'rmq' }, 'linkadz', 1000)).resolves.toBe(false);
    expect(main.closed).toBe(false);
    expect(broker.connections[1].closed).toBe(true);
  });
});

describe('probeDelayedMessagePlugin edge cases', () => {
  it('closes a probe connection that opens after the timeout, with an error listener attached', async () => {
    const broker = createFakeBroker();
    const late = new FakeConnection(broker, 'linkadz:probe');
    (amqp.connect as unknown as jest.Mock).mockImplementation(() => new Promise((resolve) => setTimeout(() => resolve(late), 80)));
    await expect(probeDelayedMessagePlugin({ hostname: 'rmq' }, 'linkadz', 20)).resolves.toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(late.closed).toBe(true);
    expect(late.listenerCount('error')).toBeGreaterThan(0);
  });

  it('gives up when the channel operations hang, and drops the probe socket with an error', async () => {
    const broker = createFakeBroker();
    const connection = new FakeConnection(broker, 'linkadz:probe') as any;
    const destroy = jest.fn();
    connection.createChannel = jest.fn(() => new Promise(() => undefined));
    connection.close = jest.fn(() => new Promise(() => undefined));
    connection.connection = { stream: { destroy } };
    (amqp.connect as unknown as jest.Mock).mockImplementation(async () => connection);
    const started = Date.now();
    await expect(probeDelayedMessagePlugin({ hostname: 'rmq' }, 'linkadz', 50)).resolves.toBe(false);
    expect(Date.now() - started).toBeLessThan(1000);
    expect(destroy).toHaveBeenCalledWith(expect.any(Error));
  });

  it('closes gracefully, without a false warning, when the broker answers 406 and the close takes a moment', async () => {
    const broker = createFakeBroker();
    broker.delayedPlugin = false;
    const connection = new FakeConnection(broker, 'linkadz:probe') as any;
    const destroy = jest.fn();
    connection.connection = { stream: { destroy } };
    connection.close = jest.fn(() => new Promise<void>((resolve) => setTimeout(resolve, 20)));
    (amqp.connect as unknown as jest.Mock).mockImplementation(async () => connection);
    const warn = jest.spyOn(Logger, 'warn').mockImplementation(() => undefined);
    await expect(probeDelayedMessagePlugin({ hostname: 'rmq' }, 'linkadz', 1000)).resolves.toBe(false);
    expect(destroy).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('does not let a shutdown abort break the graceful close after a 406', async () => {
    const broker = createFakeBroker();
    broker.delayedPlugin = false;
    const connection = new FakeConnection(broker, 'linkadz:probe') as any;
    const destroy = jest.fn();
    connection.connection = { stream: { destroy } };
    connection.close = jest.fn(() => new Promise<void>((resolve) => setTimeout(resolve, 100)));
    (amqp.connect as unknown as jest.Mock).mockImplementation(async () => connection);
    const warn = jest.spyOn(Logger, 'warn').mockImplementation(() => undefined);
    const controller = new AbortController();
    const probing = probeDelayedMessagePlugin({ hostname: 'rmq' }, 'linkadz', 1000, controller.signal);
    setTimeout(() => controller.abort(), 30); // lands inside the graceful close
    await expect(probing).resolves.toBe(false);
    expect(destroy).not.toHaveBeenCalled();
    expect((amqp.connect as unknown as jest.Mock).mock.calls.at(-1)![1].signal.aborted).toBe(false);
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('ends at once and drops the socket when aborted during the channel operations', async () => {
    const broker = createFakeBroker();
    const connection = new FakeConnection(broker, 'linkadz:probe') as any;
    const destroy = jest.fn();
    connection.createChannel = jest.fn(() => new Promise(() => undefined));
    connection.close = jest.fn(() => new Promise(() => undefined));
    connection.connection = { stream: { destroy } };
    (amqp.connect as unknown as jest.Mock).mockImplementation(async () => connection);
    const warn = jest.spyOn(Logger, 'warn').mockImplementation(() => undefined);
    const controller = new AbortController();
    const started = Date.now();
    const probing = probeDelayedMessagePlugin({ hostname: 'rmq' }, 'linkadz', 10000, controller.signal);
    setTimeout(() => controller.abort(), 30);
    await expect(probing).resolves.toBe(false);
    expect(Date.now() - started).toBeLessThan(1000);
    expect(destroy).toHaveBeenCalledWith(expect.any(Error));
    expect(warn).not.toHaveBeenCalled(); // aborting is quiet
    warn.mockRestore();
  });

  it('gives up when the probe connection hangs', async () => {
    (amqp.connect as unknown as jest.Mock).mockImplementation(() => new Promise(() => undefined));
    const started = Date.now();
    await expect(probeDelayedMessagePlugin({ hostname: 'rmq' }, 'linkadz', 50)).resolves.toBe(false);
    expect(Date.now() - started).toBeLessThan(200);
  });
});
