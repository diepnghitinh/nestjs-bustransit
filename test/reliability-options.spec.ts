import { DEFAULT_RELIABILITY, resolveReliability } from '../lib/factories/brokers/rabbitmq/reliability-options';

describe('resolveReliability', () => {
  it('uses the documented defaults', () => {
    expect(resolveReliability()).toEqual({
      reconnectDelayMs: 5000,
      readyTimeoutMs: 10000,
      publishTimeoutMs: 10000,
      sendTimeoutMs: 10000,
      consumerRestartMaxDelayMs: 60000,
      shutdownTimeoutMs: 30000,
      topologyRefreshMs: 60000,
    });
    expect(DEFAULT_RELIABILITY.shutdownTimeoutMs).toBe(30000);
  });

  it('ignores undefined overrides', () => {
    expect(resolveReliability({ shutdownTimeoutMs: undefined })).toEqual(DEFAULT_RELIABILITY);
  });

  it('applies overrides', () => {
    expect(resolveReliability({ shutdownTimeoutMs: 35000 }).shutdownTimeoutMs).toBe(35000);
  });

  it('rejects values above the largest delay Node timers accept (2147483647 ms, about 24.8 days)', () => {
    const thirtyDays = 30 * 24 * 3600 * 1000;
    expect(() => resolveReliability({ topologyRefreshMs: thirtyDays })).toThrow('reliability.topologyRefreshMs');
    expect(() => resolveReliability({ topologyRefreshMs: thirtyDays })).toThrow('2147483647');
    expect(() => resolveReliability({ publishTimeoutMs: 2147483648 })).toThrow('reliability.publishTimeoutMs');
    expect(resolveReliability({ topologyRefreshMs: 2147483647 }).topologyRefreshMs).toBe(2147483647);
  });

  it('rejects values that are not positive numbers', () => {
    expect(() => resolveReliability({ publishTimeoutMs: -1 })).toThrow('reliability.publishTimeoutMs must be a positive number of milliseconds, got -1');
    expect(() => resolveReliability({ readyTimeoutMs: Number.NaN })).toThrow('reliability.readyTimeoutMs');
    expect(() => resolveReliability({ publishTimeoutMs: 0 })).toThrow('reliability.publishTimeoutMs');
  });

  it('refreshes topology every 60 s by default and accepts an override', () => {
    expect(resolveReliability().topologyRefreshMs).toBe(60000);
    expect(resolveReliability({ topologyRefreshMs: 5000 }).topologyRefreshMs).toBe(5000);
    expect(() => resolveReliability({ topologyRefreshMs: 0 })).toThrow('reliability.topologyRefreshMs');
  });
});
