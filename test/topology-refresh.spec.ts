import { Logger } from '@nestjs/common';
import { TopologyRefreshSession } from '../lib/factories/brokers/rabbitmq/topology-refresh';
import { sleep } from './support/broker-fixture';

function fakeChannel() {
  return {
    on: jest.fn(),
    close: jest.fn().mockResolvedValue(undefined),
    checkExchange: jest.fn().mockResolvedValue({}),
    bindQueue: jest.fn().mockResolvedValue({}),
  };
}

describe('TopologyRefreshSession', () => {
  it('closes a channel that finishes opening after the refresh ended, and stays silent', async () => {
    const warn = jest.spyOn(Logger, 'warn').mockImplementation(() => undefined);
    const channel = fakeChannel();
    const session = new TopologyRefreshSession(async () => {
      await sleep(40);
      return channel as any;
    });
    // The step's only use of a channel is the exchange check, which has no later call to clean up after it.
    const attempt = session.attempt('exchange x', () => session.exchangeIfMissing('x', async () => undefined));
    await sleep(10);
    await session.end(); // the refresh timed out and was abandoned while the channel was still opening
    await attempt;
    expect(channel.close).toHaveBeenCalledTimes(1);
    expect(channel.checkExchange).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('logs one warn for a failing step and opens a fresh channel for the next', async () => {
    const warn = jest.spyOn(Logger, 'warn').mockImplementation(() => undefined);
    const first = fakeChannel();
    first.bindQueue.mockRejectedValue(Object.assign(new Error('NOT_FOUND'), { code: 404 }));
    const second = fakeChannel();
    const channels = [first, second];
    const session = new TopologyRefreshSession(async () => channels.shift() as any);
    await session.attempt('queue a', () => session.bindQueue('a', 'x'));
    await session.attempt('queue b', () => session.bindQueue('b', 'x'));
    expect(warn).toHaveBeenCalledTimes(1);
    expect(first.close).toHaveBeenCalled();
    expect(second.bindQueue).toHaveBeenCalledWith('b', 'x', '');
    await session.end();
    expect(second.close).toHaveBeenCalled();
    warn.mockRestore();
  });
});
