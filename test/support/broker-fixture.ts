import * as amqp from 'amqplib';
import { BusTransitBrokerRabbitMqFactory } from '../../lib/factories/brokers/bustransit-broker.rabbitmq';
import { IPublishEndpoint } from '../../lib/interfaces/publish-endpoint.interface';
import { createFakeBroker, FakeBroker, FakeConnection } from './fake-amqp';

export const TEST_RELIABILITY = {
  reconnectDelayMs: 20,
  readyTimeoutMs: 200,
  publishTimeoutMs: 200,
  sendTimeoutMs: 200,
  consumerRestartMaxDelayMs: 80,
  shutdownTimeoutMs: 300,
};

export interface BrokerFixture {
  bus: BusTransitBrokerRabbitMqFactory;
  broker: FakeBroker;
  instances: Map<unknown, unknown>;
}

export interface BrokerFixtureOptions {
  messages?: Record<string, unknown>;
  consumers?: Record<string, unknown>;
  endpoints?: Record<string, unknown>;
  instances?: Map<unknown, unknown>;
  preexistingExchanges?: Record<string, string>;
  preexistingQueues?: string[];
  broker?: FakeBroker;
  start?: boolean;
  reliability?: Partial<typeof TEST_RELIABILITY> & { topologyRefreshMs?: number };
}

export function mockConnect(broker: FakeBroker) {
  (amqp.connect as unknown as jest.Mock).mockImplementation(
    async (_url: unknown, socketOptions?: any) => new FakeConnection(broker, socketOptions?.clientProperties?.connection_name ?? ''),
  );
}

export async function startBroker(opts: BrokerFixtureOptions = {}): Promise<BrokerFixture> {
  const broker = opts.broker ?? createFakeBroker();
  for (const [name, type] of Object.entries(opts.preexistingExchanges ?? {})) broker.exchanges.set(name, type);
  for (const queue of opts.preexistingQueues ?? []) broker.queues.add(queue);
  mockConnect(broker);

  const bus = new BusTransitBrokerRabbitMqFactory();
  bus.setBrokerConfig({
    brokerName: 'linkadz',
    brokerType: 'RABBITMQ',
    brokerInfo: { host: 'rmq', vhost: '/test', username: 'u', password: 'p', port: 5672 },
    reliability: { ...TEST_RELIABILITY, ...(opts.reliability ?? {}) },
  } as any);
  const instances = opts.instances ?? new Map();
  if (!instances.has(IPublishEndpoint)) instances.set(IPublishEndpoint, {});
  bus.setModuleRef({
    get: (token: any) => {
      if (!instances.has(token)) throw new Error(`no instance for ${token?.name ?? String(token)}`);
      return instances.get(token);
    },
  });
  bus.setConsumers(opts.consumers ?? {}, opts.endpoints ?? {}, opts.messages ?? {});
  if (opts.start !== false) await bus.start();
  return { bus, broker, instances };
}

export const flush = () => new Promise<void>((resolve) => setImmediate(resolve));
export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function eventually(check: () => boolean, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (check()) return;
    await sleep(10);
  }
  throw new Error(`condition not met within ${timeoutMs}ms`);
}
