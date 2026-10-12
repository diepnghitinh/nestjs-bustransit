import { EventEmitter } from 'events';
import { ChannelRegistry } from '../lib/factories/brokers/rabbitmq/channel-registry';

class StubChannel extends EventEmitter {
  closed = false;
  async close() {
    this.closed = true;
    this.emit('close');
  }
}
const stub = () => new StubChannel() as any;

describe('ChannelRegistry', () => {
  it('creates a channel once and reuses it', async () => {
    const registry = new ChannelRegistry();
    const create = jest.fn(async () => stub());
    const a = await registry.getOrCreate('_producer', create);
    const b = await registry.getOrCreate('_producer', create);
    expect(a).toBe(b);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('shares one creation between concurrent callers', async () => {
    const registry = new ChannelRegistry();
    const create = jest.fn(async () => stub());
    const [a, b, c] = await Promise.all([
      registry.getOrCreate('q', create),
      registry.getOrCreate('q', create),
      registry.getOrCreate('q', create),
    ]);
    expect(create).toHaveBeenCalledTimes(1);
    expect(a).toBe(b);
    expect(b).toBe(c);
  });

  it('forgets a channel that closes and reports it, so the next call opens a new one', async () => {
    const onLost = jest.fn();
    const registry = new ChannelRegistry(onLost);
    const first = await registry.getOrCreate('_producer', async () => stub());
    first.emit('close');
    expect(registry.get('_producer')).toBeUndefined();
    expect(onLost).toHaveBeenCalledWith('_producer');
    const second = await registry.getOrCreate('_producer', async () => stub());
    expect(second).not.toBe(first);
  });

  it('does not register a channel that closed while it was opening, and retries once', async () => {
    const onLost = jest.fn();
    const registry = new ChannelRegistry(onLost);
    const first = stub();
    const second = stub();
    const create = jest.fn(async (track: (c: any) => any) => {
      if (create.mock.calls.length === 1) {
        track(first);
        first.emit('close'); // closes before create() resolves
        return first;
      }
      return second;
    });
    const channel = await registry.getOrCreate('_producer', create);
    expect(channel).toBe(second);
    expect(create).toHaveBeenCalledTimes(2);
    expect(registry.get('_producer')).toBe(second);
    expect(onLost).not.toHaveBeenCalled();
  });

  it('rejects with a clear error when the retry also closes while opening', async () => {
    const registry = new ChannelRegistry();
    const create = jest.fn(async (track: (c: any) => any) => {
      const channel = track(stub());
      channel.emit('close');
      return channel;
    });
    await expect(registry.getOrCreate('_producer', create)).rejects.toThrow("Channel '_producer' closed while it was opening");
    expect(registry.has('_producer')).toBe(false);
  });

  it('reports has() while a channel is opening', async () => {
    const registry = new ChannelRegistry();
    let release!: (c: any) => void;
    const pending = registry.getOrCreate('q', () => new Promise<any>((resolve) => (release = resolve)));
    expect(registry.has('q')).toBe(true);
    release(stub());
    await pending;
    expect(registry.has('q')).toBe(true);
  });

  it('does not report channels it was told to forget', async () => {
    const onLost = jest.fn();
    const registry = new ChannelRegistry(onLost);
    const channel = await registry.getOrCreate('q', async () => stub());
    registry.clear();
    channel.emit('close');
    expect(onLost).not.toHaveBeenCalled();
  });

  it('closes every channel without reporting them as lost', async () => {
    const onLost = jest.fn();
    const registry = new ChannelRegistry(onLost);
    const a = await registry.getOrCreate('a', async () => stub());
    const b = await registry.getOrCreate('b', async () => stub());
    await registry.closeAll();
    expect(a.closed && b.closed).toBe(true);
    expect(onLost).not.toHaveBeenCalled();
  });

  it('does not keep a failed creation', async () => {
    const registry = new ChannelRegistry();
    await expect(registry.getOrCreate('q', async () => { throw new Error('no connection'); })).rejects.toThrow('no connection');
    expect(registry.has('q')).toBe(false);
  });

  it('does not register a channel that finishes opening after clear()', async () => {
    const registry = new ChannelRegistry();
    let release!: (c: any) => void;
    const pending = registry.getOrCreate('q', () => new Promise<any>((resolve) => (release = resolve)));
    registry.clear();
    const s = stub();
    release(s);
    await expect(pending).rejects.toThrow('The connection was reset while the channel was opening');
    expect(registry.get('q')).toBeUndefined();
    expect(s.closed).toBe(true);
  });

  it('keeps a newer creation pending when an older one settles after clear()', async () => {
    const registry = new ChannelRegistry();
    let releaseA!: (c: any) => void;
    let releaseB!: (c: any) => void;

    const pendingA = registry.getOrCreate('q', () => new Promise<any>((resolve) => (releaseA = resolve)));
    registry.clear();
    const pendingB = registry.getOrCreate('q', () => new Promise<any>((resolve) => (releaseB = resolve)));

    const stubA = stub();
    releaseA(stubA);
    await expect(pendingA).rejects.toThrow('The connection was reset');

    expect(registry.has('q')).toBe(true);
    const create = jest.fn(async () => stub());
    const pendingC = registry.getOrCreate('q', create);
    expect(create).not.toHaveBeenCalled();
    expect(pendingC).toBe(pendingB);

    const stubB = stub();
    releaseB(stubB);
    const result = await pendingB;
    expect(result).toBe(stubB);
  });

  it('closes a channel that was still opening during closeAll()', async () => {
    const registry = new ChannelRegistry();
    let release!: (c: any) => void;
    const pending = registry.getOrCreate('q', () => new Promise<any>((resolve) => (release = resolve)));

    await registry.closeAll();

    const s = stub();
    release(s);
    await expect(pending).rejects.toThrow('The connection was reset');
    expect(s.closed).toBe(true);
  });

  it('turns a create() that throws synchronously into a rejection', async () => {
    const registry = new ChannelRegistry();
    await expect(registry.getOrCreate('q', () => { throw new Error('boom'); })).rejects.toThrow('boom');
    expect(registry.has('q')).toBe(false);
  });
});
