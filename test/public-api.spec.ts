import { BusTransitCoreModule } from '../lib/bustransit.core';
import { BusTransitService } from '../lib/bustransit.service';
import { RabbitMqBusFactoryConfigurator } from '../lib/factories/rabbitmq-bus-factory.configurator';

describe('public API', () => {
  it('keeps reliability settings whether UseReliability comes before or after Host', () => {
    const before = new RabbitMqBusFactoryConfigurator();
    before.UseReliability({ shutdownTimeoutMs: 35000 });
    before.Host('rmq', '/prod', (h) => h.Username('u'));
    expect(before.getOptions().reliability).toEqual({ shutdownTimeoutMs: 35000 });

    const after = new RabbitMqBusFactoryConfigurator();
    after.Host('rmq', '/prod', (h) => h.Username('u'));
    after.UseReliability({ readyTimeoutMs: 5000 });
    expect(after.getOptions().reliability).toEqual({ readyTimeoutMs: 5000 });
  });

  it('rejects invalid reliability settings at configuration time', () => {
    const cfg = new RabbitMqBusFactoryConfigurator();
    expect(() => cfg.UseReliability({ publishTimeoutMs: -5 })).toThrow('reliability.publishTimeoutMs must be a positive number of milliseconds');
  });

  it('drains before other modules shut down and closes the connection last', async () => {
    const calls: string[] = [];
    const service = {
      stopConsuming: async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
        calls.push('stopConsuming');
      },
      close: async () => {
        calls.push('close');
      },
    } as unknown as BusTransitService;
    const core = new BusTransitCoreModule({} as any, {} as any, service);
    await core.beforeApplicationShutdown();
    expect(calls).toEqual(['stopConsuming']);
    await core.onApplicationShutdown();
    expect(calls).toEqual(['stopConsuming', 'close']);
  });

  it('reports health from the broker', () => {
    const health = { connected: true, blocked: false, consumers: { ping: 'consuming' as const } };
    const service = Object.create(BusTransitService.prototype) as BusTransitService;
    (service as any).broker = { health: () => health };
    expect(service.getHealth()).toBe(health);
  });
});
