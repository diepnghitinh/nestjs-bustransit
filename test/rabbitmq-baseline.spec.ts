jest.mock('amqplib', () => ({ connect: jest.fn() }));
import { flush, startBroker } from './support/broker-fixture';

class OrderPlaced {
  constructor(public orderId = 'o-1') {}
}

describe('RabbitMQ broker baseline', () => {
  it('publishes to the exchange named after the message class', async () => {
    const { bus, broker } = await startBroker({
      messages: { OrderPlaced },
      preexistingExchanges: { 'linkadz:OrderPlaced': 'fanout' },
    });

    await bus.publish(new OrderPlaced());
    await flush();

    const sent = broker.published.find((p) => p.exchange === 'linkadz:OrderPlaced');
    expect(sent?.content.message).toEqual({ orderId: 'o-1' });
    expect(sent?.content.messageType).toBe('message:linkadz:OrderPlaced');
    await bus.close();
  });
});
