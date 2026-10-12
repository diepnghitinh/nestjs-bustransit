jest.mock('amqplib', () => ({ connect: jest.fn() }));
import { sleep } from './support/broker-fixture';
import { startWithTopology } from './support/topology-fixture';

describe('RabbitMQ topology (characterization of 0.3.x)', () => {
  it('declares the same exchanges, bindings and queues', async () => {
    const { bus, broker } = await startWithTopology();
    await sleep(30);

    const exchanges = [...broker.exchanges.keys()].filter((name) => name.startsWith('linkadz:')).sort();
    expect(exchanges).toEqual([
      'linkadz:ChargeCard',
      'linkadz:OrderState',
      'linkadz:OrderSubmitted',
      'linkadz:PingMessage',
      'linkadz:order-saga',
      'linkadz:ping',
    ]);
    expect(broker.exchanges.get('linkadz:ping')).toBe('fanout');

    const bindings = [...new Set(broker.bindings.map((b) => `${b.source} -> ${b.dest}`))].sort();
    expect(bindings).toEqual([
      'linkadz:OrderState -> linkadz:order-saga',
      'linkadz:OrderSubmitted -> linkadz:order-saga',
      'linkadz:PingMessage -> linkadz:ping',
      'linkadz:order-saga -> queue:order-saga',
      'linkadz:ping -> queue:ping',
    ]);
    expect([...broker.queues].sort()).toEqual(['order-saga', 'ping']);
    await bus.close();
  });
});
