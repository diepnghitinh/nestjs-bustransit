import { EventEmitter } from 'events';
import { BusTransitConsumer } from '../lib/factories/consumer';
import { RetryConfigurator, RetryLevel } from '../lib/factories/retry.configurator';
import { createDeliveryHandler, DeliveryContext, redeliveryDelay } from '../lib/factories/brokers/rabbitmq/delivery-pipeline';
import { IPublishEndpoint } from '../lib/interfaces/publish-endpoint.interface';
import { sleep } from './support/broker-fixture';

class PingMessage {
  text: string;
}
class PingConsumer extends BusTransitConsumer<PingMessage> {
  calls = 0;
  failTimes = 0;
  lastSaga: unknown;
  constructor() {
    super(PingMessage);
  }
  async Consume(ctx, context): Promise<any> {
    await super.Consume(ctx, context);
    this.calls++;
    this.lastSaga = ctx.Saga;
    if (this.failTimes-- > 0) throw new Error('boom');
    return { ok: true };
  }
}

function setup(overrides: Partial<DeliveryContext> = {}) {
  const consumer = new PingConsumer();
  const publisher = { publishRaw: jest.fn(async () => undefined), ensureQueue: jest.fn(async () => undefined), exchangeExists: jest.fn(async () => true) };
  const channel = Object.assign(new EventEmitter(), { ack: jest.fn(), nack: jest.fn(), publish: jest.fn() });
  const handle = createDeliveryHandler({
    queue: 'ping',
    consumer: PingConsumer,
    redeliveryEnabled: () => false,
    delayExchange: 'linkadz:delayed.exchange.ping',
    resolve: (token) => (token === PingConsumer ? consumer : token === IPublishEndpoint ? {} : undefined),
    publisher,
    hostInfo: () => ({ machineName: 'test' }),
    requeueDelayMs: 20,
    ...overrides,
  });
  const message = (body: unknown, properties: Record<string, unknown> = {}) =>
    ({
      content: Buffer.from(typeof body === 'string' ? body : JSON.stringify(body)),
      fields: { deliveryTag: 1 },
      properties: { headers: {}, ...properties },
    }) as any;
  return { consumer, publisher, channel, handle, message };
}

const retry = (level: RetryLevel, configure: (r: RetryConfigurator) => void) => {
  const r = new RetryConfigurator(level);
  configure(r);
  return r.getRetryValue();
};

describe('redeliveryDelay', () => {
  it('computes the delay for each retry type', () => {
    expect(redeliveryDelay({ retryType: 0, retryValue: 3 }, 0)).toEqual({ maxRetries: 3, delayMs: 0 });
    expect(redeliveryDelay({ retryType: 1, retryValue: [2, 1000] }, 1)).toEqual({ maxRetries: 2, delayMs: 1000 });
    expect(redeliveryDelay({ retryType: 2, retryValue: [5000, 15000] }, 1)).toEqual({ maxRetries: 2, delayMs: 15000 });
    expect(redeliveryDelay({ retryType: 3, retryValue: [3, 1000, 2] }, 2)).toEqual({ maxRetries: 3, delayMs: 4000 });
  });
});

describe('delivery pipeline', () => {
  it('runs the consumer, passes the saga header and acks', async () => {
    const { consumer, channel, handle, message } = setup();
    const msg = message({ message: { text: 'a.b.c' }, headers: { saga: { CorrelationId: 'c-1' } } });
    await handle(channel as any, msg);
    expect(consumer.calls).toBe(1);
    expect(consumer.lastSaga).toEqual({ CorrelationId: 'c-1' });
    expect(channel.ack).toHaveBeenCalledWith(msg);
  });

  it('replies when the message asks for a reply', async () => {
    const { channel, handle, message } = setup();
    await handle(channel as any, message({ message: { text: 'x' } }, { replyTo: 'amq.rabbitmq.reply-to', correlationId: 'c-1' }));
    const [exchange, routingKey, content, options] = channel.publish.mock.calls[0];
    expect([exchange, routingKey]).toEqual(['', 'amq.rabbitmq.reply-to']);
    expect(JSON.parse(content.toString())).toEqual({ ok: true });
    expect(options).toEqual({ correlationId: 'c-1' });
  });

  it('moves a message that is not JSON to the error queue, then acks', async () => {
    const { consumer, publisher, channel, handle, message } = setup();
    const msg = message('not json');
    await handle(channel as any, msg);
    expect(consumer.calls).toBe(0);
    expect(publisher.ensureQueue).toHaveBeenCalledWith('ping_error');
    const [, queue, payload, options] = publisher.publishRaw.mock.calls[0] as any[];
    expect(queue).toBe('ping_error');
    expect(payload.message).toBe('not json');
    expect(options).toEqual({ persistent: true, mandatory: true, rejectIfUnroutable: true });
    expect(channel.ack).toHaveBeenCalledWith(msg);
  });

  it('retries in place, then moves the message to the error queue', async () => {
    const { consumer, publisher, channel, handle, message } = setup({
      retryPattern: retry(RetryLevel.retry, (r) => r.Immediate(2)),
    });
    consumer.failTimes = 5;
    await handle(channel as any, message({ message: { text: 'x' } }));
    expect(consumer.calls).toBe(3);
    const [, , payload] = publisher.publishRaw.mock.calls[0] as any[];
    expect(payload.error.message).toBe('boom');
    expect(channel.ack).toHaveBeenCalledTimes(1);
  });

  it('schedules a delayed redelivery instead of the error queue while attempts remain', async () => {
    const { consumer, publisher, channel, handle, message } = setup({
      redeliveryPattern: retry(RetryLevel.redelivery, (r) => r.Intervals(5000, 15000)),
      redeliveryEnabled: () => true,
    });
    consumer.failTimes = 1;
    await handle(channel as any, message({ message: { text: 'x' } }, { messageId: 'm-1', headers: { 'x-redelivery': 1 } }));
    const [exchange, routingKey, body, options] = publisher.publishRaw.mock.calls[0] as any[];
    expect([exchange, routingKey]).toEqual(['linkadz:delayed.exchange.ping', '']);
    expect(body.message).toEqual({ text: 'x' });
    expect(options.headers).toMatchObject({ 'x-delay': 15000, 'x-redelivery': 2 });
    expect(options.persistent).toBe(true);
    expect(options.messageId).toBe('m-1');
    expect(publisher.ensureQueue).not.toHaveBeenCalled();
    expect(channel.ack).toHaveBeenCalledTimes(1);
  });

  it('checks that the delay exchange exists before publishing a delayed redelivery', async () => {
    const { consumer, publisher, channel, handle, message } = setup({
      redeliveryPattern: retry(RetryLevel.redelivery, (r) => r.Intervals(5000, 15000)),
      redeliveryEnabled: () => true,
    });
    consumer.failTimes = 1;
    await handle(channel as any, message({ message: { text: 'x' } }, { headers: { 'x-redelivery': 1 } }));
    expect(publisher.exchangeExists).toHaveBeenCalledWith('linkadz:delayed.exchange.ping');
    expect(publisher.exchangeExists.mock.invocationCallOrder[0]).toBeLessThan(publisher.publishRaw.mock.invocationCallOrder[0]);
  });

  it('sends the message to the error queue when the delay exchange was deleted', async () => {
    const { consumer, publisher, channel, handle, message } = setup({
      redeliveryPattern: retry(RetryLevel.redelivery, (r) => r.Intervals(5000, 15000)),
      redeliveryEnabled: () => true,
    });
    publisher.exchangeExists.mockResolvedValue(false);
    consumer.failTimes = 1;
    await handle(channel as any, message({ message: { text: 'x' } }, { headers: { 'x-redelivery': 1 } }));
    expect(publisher.publishRaw).toHaveBeenCalledTimes(1);
    expect((publisher.publishRaw.mock.calls[0] as any[]).slice(0, 2)).toEqual(['', 'ping_error']);
    expect(publisher.ensureQueue).toHaveBeenCalledWith('ping_error');
    expect(channel.ack).toHaveBeenCalledTimes(1);
  });

  it('asks the publisher to reject an unroutable error-queue copy', async () => {
    const { consumer, publisher, channel, handle, message } = setup();
    consumer.failTimes = 1;
    await handle(channel as any, message({ message: { text: 'x' } }));
    const options = (publisher.publishRaw.mock.calls[0] as any[])[3];
    expect(options).toMatchObject({ mandatory: true, rejectIfUnroutable: true });
  });

  it('goes to the error queue once redelivery attempts are used up', async () => {
    const { consumer, publisher, channel, handle, message } = setup({
      redeliveryPattern: retry(RetryLevel.redelivery, (r) => r.Intervals(5000, 15000)),
      redeliveryEnabled: () => true,
    });
    consumer.failTimes = 1;
    await handle(channel as any, message({ message: { text: 'x' } }, { headers: { 'x-redelivery': 2 } }));
    expect((publisher.publishRaw.mock.calls[0] as any[])[1]).toBe('ping_error');
  });

  it('requeues instead of acking when the failed message cannot be parked', async () => {
    const { consumer, publisher, channel, handle, message } = setup();
    consumer.failTimes = 1;
    (publisher.publishRaw as any).mockRejectedValue(new Error('[RabbitMQ] Not connected to broker after 10000ms'));
    const msg = message({ message: { text: 'x' } });
    await handle(channel as any, msg);
    expect(channel.ack).not.toHaveBeenCalled();
    expect(channel.nack).toHaveBeenCalledWith(msg, false, true);
  });

  it('does not throw when the channel is already closed at ack time', async () => {
    const { channel, handle, message } = setup();
    channel.ack.mockImplementation(() => {
      throw new Error('Channel closed');
    });
    await expect(handle(channel as any, message({ message: { text: 'x' } }))).resolves.toBeUndefined();
  });
});

describe('delivery pipeline during shutdown and channel loss', () => {
  it('requeues a failed message instead of parking it while the bus is stopping', async () => {
    let stopping = false;
    const { consumer, publisher, channel, handle, message } = setup({
      retryPattern: retry(RetryLevel.retry, (r) => r.Immediate(1)),
      stopping: () => stopping,
    });
    consumer.failTimes = 5;
    stopping = true;
    const msg = message({ message: { text: 'x' } });
    await handle(channel as any, msg);
    expect(consumer.calls).toBe(2); // the in-place retries still run
    expect(publisher.publishRaw).not.toHaveBeenCalled();
    expect(publisher.ensureQueue).not.toHaveBeenCalled();
    expect(channel.ack).not.toHaveBeenCalled();
    expect(channel.nack).toHaveBeenCalledWith(msg, false, true);
  });

  it('waits requeueDelayMs before handing back a message that failed during shutdown', async () => {
    const { consumer, channel, handle, message } = setup({ stopping: () => true, requeueDelayMs: 100 });
    consumer.failTimes = 1;
    const started = Date.now();
    const handling = handle(channel as any, message({ message: { text: 'x' } }));
    await sleep(30);
    expect(channel.nack).not.toHaveBeenCalled();
    await handling;
    expect(Date.now() - started).toBeGreaterThanOrEqual(95);
    expect(channel.nack).toHaveBeenCalledTimes(1);
  });

  it('still parks failed messages when the bus is not stopping', async () => {
    const { consumer, publisher, channel, handle, message } = setup({ stopping: () => false });
    consumer.failTimes = 1;
    await handle(channel as any, message({ message: { text: 'x' } }));
    expect((publisher.publishRaw.mock.calls[0] as any[]).slice(0, 2)).toEqual(['', 'ping_error']);
    expect(channel.ack).toHaveBeenCalledTimes(1);
  });

  it('requeues, without trying the error queue, when the delay-exchange check fails for another reason than 404', async () => {
    const { consumer, publisher, channel, handle, message } = setup({
      redeliveryPattern: retry(RetryLevel.redelivery, (r) => r.Intervals(5000, 15000)),
      redeliveryEnabled: () => true,
    });
    publisher.exchangeExists.mockRejectedValue(new Error('ECONNRESET'));
    consumer.failTimes = 1;
    const msg = message({ message: { text: 'x' } });
    await handle(channel as any, msg);
    expect(publisher.publishRaw).not.toHaveBeenCalled();
    expect(publisher.ensureQueue).not.toHaveBeenCalled();
    expect(channel.ack).not.toHaveBeenCalled();
    expect(channel.nack).toHaveBeenCalledWith(msg, false, true);
  });

  it('does not park a failed message whose channel closed while it was handled', async () => {
    const { consumer, publisher, channel, handle, message } = setup();
    const consume = consumer.Consume.bind(consumer);
    consumer.Consume = async (ctx, context) => {
      channel.emit('close'); // the consumer channel dies while the handler runs
      return consume(ctx, context);
    };
    consumer.failTimes = 1;
    await handle(channel as any, message({ message: { text: 'x' } }));
    expect(publisher.publishRaw).not.toHaveBeenCalled();
    expect(channel.ack).not.toHaveBeenCalled();
    expect(channel.nack).not.toHaveBeenCalled();
  });
});

describe('delivery pipeline edge cases', () => {
  it('does not run the consumer again when sending the reply fails', async () => {
    const { consumer, publisher, channel, handle, message } = setup();
    channel.publish.mockImplementation(() => {
      throw new Error('Channel closed');
    });
    await handle(channel as any, message({ message: { text: 'x' } }, { replyTo: 'amq.rabbitmq.reply-to', correlationId: 'c-1' }));
    expect(consumer.calls).toBe(1);
    expect(publisher.publishRaw).not.toHaveBeenCalled();
    expect(channel.ack).toHaveBeenCalledTimes(1);
  });

  it('moves JSON that is not an envelope to the error queue', async () => {
    const { publisher, channel, handle, message } = setup();
    await handle(channel as any, message('null'));
    expect((publisher.publishRaw.mock.calls[0] as any[])[1]).toBe('ping_error');
    expect(channel.ack).toHaveBeenCalledTimes(1);
  });

  it('parks a message that has no headers', async () => {
    const { publisher, channel, handle, message } = setup();
    const msg = message('not json');
    msg.properties = {};
    await handle(channel as any, msg);
    expect(publisher.publishRaw).toHaveBeenCalled();
    expect(channel.ack).toHaveBeenCalledTimes(1);
  });

  it('moves the message to the error queue when scheduling a redelivery fails', async () => {
    const { consumer, publisher, channel, handle, message } = setup({
      redeliveryPattern: retry(RetryLevel.redelivery, (r) => r.Intervals(5000, 15000)),
      redeliveryEnabled: () => true,
    });
    consumer.failTimes = 1;
    (publisher.publishRaw as any).mockImplementation(async (exchange: string, routingKey: string, body: any, options: any) => {
      if (exchange === 'linkadz:delayed.exchange.ping') throw new Error('NOT_FOUND - no exchange');
    });
    await handle(channel as any, message({ message: { text: 'x' } }, { headers: { 'x-redelivery': 1 } }));
    const calls = (publisher.publishRaw as any).mock.calls;
    expect(calls.some((call: any) => call[0] === 'linkadz:delayed.exchange.ping')).toBe(true);
    expect(calls.some((call: any) => call[1] === 'ping_error')).toBe(true);
    expect(channel.ack).toHaveBeenCalledTimes(1);
    expect(channel.nack).not.toHaveBeenCalled();
  });

  it('treats a malformed x-redelivery header as exhausted', async () => {
    const { consumer, publisher, channel, handle, message } = setup({
      redeliveryPattern: retry(RetryLevel.redelivery, (r) => r.Intervals(5000, 15000)),
      redeliveryEnabled: () => true,
    });
    consumer.failTimes = 1;
    await handle(channel as any, message({ message: { text: 'x' } }, { headers: { 'x-redelivery': 'abc' } }));
    const calls = (publisher.publishRaw as any).mock.calls;
    expect(calls.some((call: any) => call[0] === 'linkadz:delayed.exchange.ping')).toBe(false);
    expect(calls.some((call: any) => call[1] === 'ping_error')).toBe(true);
    expect(channel.ack).toHaveBeenCalledTimes(1);
  });
});
