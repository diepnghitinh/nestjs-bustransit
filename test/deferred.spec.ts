import { createDeferred, withTimeout } from '../lib/utils/deferred';

describe('deferred', () => {
  it('resolves once and reports settled', async () => {
    const d = createDeferred<number>();
    expect(d.settled).toBe(false);
    d.resolve(1);
    d.resolve(2);
    await expect(d.promise).resolves.toBe(1);
    expect(d.settled).toBe(true);
  });

  it('rejects with the given message after the timeout', async () => {
    await expect(withTimeout(new Promise(() => undefined), 20, 'too slow')).rejects.toThrow('too slow');
  });

  it('passes the value through when it arrives in time', async () => {
    await expect(withTimeout(Promise.resolve('ok'), 50, 'too slow')).resolves.toBe('ok');
  });
});
