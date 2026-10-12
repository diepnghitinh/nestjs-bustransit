jest.mock('amqplib', () => ({ connect: jest.fn() }));
import { Logger } from '@nestjs/common';
import { ConsumerConfigurator } from '../lib/factories/consumer.configurator';
import { SagaConfigurator } from '../lib/factories/saga.configurator';
import { ConnectionManager } from '../lib/factories/brokers/rabbitmq/connection-manager';
import { Publisher } from '../lib/factories/brokers/rabbitmq/publisher';
import { resolveReliability } from '../lib/factories/brokers/rabbitmq/reliability-options';
import { buildTopology, declareTopology, TopologyMaps } from '../lib/factories/brokers/rabbitmq/topology';
import { mockConnect } from './support/broker-fixture';
import { createFakeBroker } from './support/fake-amqp';
import { OrderState, OrderStateMachine, PingConsumer } from './support/topology-fixture';

function config() {
  const ping = new ConsumerConfigurator();
  ping.bindQueue('ping');
  ping.bindConsumer(PingConsumer);
  const saga = new SagaConfigurator();
  saga.bindQueue('order-saga');
  saga.bindConsumer(OrderStateMachine);
  const instances = new Map<unknown, unknown>([
    [PingConsumer, new PingConsumer()],
    [OrderStateMachine, new OrderStateMachine()],
  ]);
  return {
    consumers: { PingConsumer, OrderStateMachine: { machineClass: OrderStateMachine, stateClass: OrderState } } as Record<string, any>,
    endpoints: { ping, 'order-saga': saga } as Record<string, any>,
    resolve: (token: unknown) => {
      if (!instances.has(token)) throw new Error('not registered');
      return instances.get(token);
    },
  };
}

const emptyMaps = (): TopologyMaps => ({ classConsumerToEndpoint: {}, classMessageToEndpoint: {}, classMessageToExchange: {} });

describe('buildTopology', () => {
  it('produces the 0.3.x declarations and fills the routing maps', () => {
    const { consumers, endpoints, resolve } = config();
    const maps = emptyMaps();

    expect(buildTopology(consumers, endpoints, resolve, maps)).toEqual([
      { exchange: 'OrderState', bindTo: null },
      { exchange: 'OrderSubmitted', bindTo: 'order-saga' },
      { exchange: 'ChargeCard', bindTo: null },
      { exchange: 'PingMessage', bindTo: 'ping' },
      { exchange: 'OrderState', bindTo: 'order-saga' },
    ]);
    expect(maps.classMessageToExchange).toEqual({ PingMessage: 'ping', OrderState: 'order-saga' });
    expect(maps.classConsumerToEndpoint).toEqual({ PingConsumer: 'ping', OrderStateMachine: 'order-saga' });
    expect(maps.classMessageToEndpoint.OrderSubmitted.Name).toBe('order-saga');
  });

  it('skips a consumer that is not registered as a provider and keeps the rest', () => {
    const error = jest.spyOn(Logger, 'error').mockImplementation(() => undefined);
    const { consumers, endpoints } = config();
    const onlyPing = (token: unknown) => {
      if (token === PingConsumer) return new PingConsumer();
      throw new Error('not registered');
    };

    const declarations = buildTopology(consumers, endpoints, onlyPing, emptyMaps());
    expect(declarations).toEqual([{ exchange: 'PingMessage', bindTo: 'ping' }]);
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });
});

describe('declareTopology', () => {
  it('declares every exchange and binding, and keeps going after one is refused', async () => {
    const error = jest.spyOn(Logger, 'error').mockImplementation(() => undefined);
    const broker = createFakeBroker();
    broker.exchanges.set('linkadz:Legacy', 'direct');
    mockConnect(broker);
    const reliability = resolveReliability({ reconnectDelayMs: 20 });
    let publisher!: Publisher;
    const manager = new ConnectionManager({ hostname: 'rmq' }, 'linkadz', reliability, () => publisher.open());
    publisher = new Publisher(manager, reliability);
    await manager.start();
    const ensure = publisher.ensureExchange.bind(publisher);
    jest.spyOn(publisher, 'ensureExchange').mockImplementation((name: string) =>
      name === 'linkadz:Legacy' ? Promise.reject(new Error('PRECONDITION_FAILED')) : ensure(name),
    );

    await declareTopology(
      publisher,
      [
        { exchange: 'Legacy', bindTo: 'ping' },
        { exchange: 'PingMessage', bindTo: 'ping' },
        { exchange: 'ChargeCard', bindTo: null },
      ],
      (name) => `linkadz:${name}`,
    );

    expect(broker.exchanges.get('linkadz:PingMessage')).toBe('fanout');
    expect(broker.exchanges.get('linkadz:ChargeCard')).toBe('fanout');
    expect(broker.bindings).toContainEqual({ source: 'linkadz:PingMessage', dest: 'linkadz:ping' });
    expect(error.mock.calls.some(([msg]) => String(msg).includes("Could not declare exchange 'linkadz:Legacy'"))).toBe(true);
    expect(broker.channels.find((c) => c.confirm)?.closed).toBe(false);
    error.mockRestore();
    await manager.close();
  });

  it('uses an exchange that exists with other settings as it is and still binds it', async () => {
    const error = jest.spyOn(Logger, 'error').mockImplementation(() => undefined);
    const broker = createFakeBroker();
    broker.exchanges.set('linkadz:Legacy', 'direct');
    broker.exchanges.set('linkadz:ping', 'direct');
    mockConnect(broker);
    const reliability = resolveReliability({ reconnectDelayMs: 20 });
    let publisher!: Publisher;
    const manager = new ConnectionManager({ hostname: 'rmq' }, 'linkadz', reliability, () => publisher.open());
    publisher = new Publisher(manager, reliability);
    await manager.start();

    await declareTopology(publisher, [{ exchange: 'Legacy', bindTo: 'ping' }], (name) => `linkadz:${name}`);

    expect(error).not.toHaveBeenCalled();
    expect(broker.exchanges.get('linkadz:Legacy')).toBe('direct');
    expect(broker.bindings).toContainEqual({ source: 'linkadz:Legacy', dest: 'linkadz:ping' });
    error.mockRestore();
    await manager.close();
  });
});
