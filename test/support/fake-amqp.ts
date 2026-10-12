import { EventEmitter } from 'events';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { IllegalOperationError } = require('amqplib/lib/error');

export interface PublishedRecord {
  channel: number;
  exchange: string;
  routingKey: string;
  content: any;
  options: any;
}

export interface FakeBroker {
  exchanges: Map<string, string>;
  queues: Set<string>;
  bindings: { source: string; dest: string }[];
  published: PublishedRecord[];
  asserts: string[];
  serverCloses: { channel: number; code: number; text: string }[];
  connections: FakeConnection[];
  channels: FakeChannel[];
  /** false: the x-delayed-message plugin is not installed. */
  delayedPlugin: boolean;
  /** true: publisher confirms never arrive, like a broker blocking publishers. */
  holdConfirms: boolean;
  /** Queues that exist with other arguments: asserting them fails with 406. */
  queueConflicts: Set<string>;
  /** The next call of this method on any connection throws this error. */
  failNext: Partial<Record<'createChannel' | 'createConfirmChannel', Error>>;
}

export function createFakeBroker(): FakeBroker {
  return {
    exchanges: new Map(),
    queues: new Set(),
    bindings: [],
    published: [],
    asserts: [],
    serverCloses: [],
    connections: [],
    channels: [],
    delayedPlugin: true,
    holdConfirms: false,
    queueConflicts: new Set(),
    failNext: {},
  };
}

export const mainConnections = (broker: FakeBroker) => broker.connections.filter((c) => !c.name.endsWith(':probe'));

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

export class FakeChannel extends EventEmitter {
  closed = false;
  acks: any[] = [];
  nacks: { message: any; requeue: boolean }[] = [];
  consumers = new Map<string, (msg: any) => void>();
  private unconfirmed: Array<(err: Error | null) => void> = [];
  private tag = 0;

  constructor(
    readonly broker: FakeBroker,
    readonly connection: FakeConnection,
    readonly id: number,
    readonly confirm: boolean,
  ) {
    super();
  }

  private guard() {
    if (this.closed) throw new IllegalOperationError('Channel closed');
  }

  private async rpc<T>(fn: () => T): Promise<T> {
    this.guard();
    await tick();
    if (this.closed) throw new Error('Channel ended, no reply will be forthcoming');
    return fn();
  }

  private refuse(code: number, label: string, text: string): never {
    this.serverClose(code, text);
    const err: any = new Error(`Operation failed: ${code} (${label}) with message "${text}"`);
    err.code = code;
    throw err;
  }

  prefetch(_count?: number) {
    return this.rpc(() => undefined);
  }

  assertExchange(name: string, type: string, _options?: any) {
    return this.rpc(() => {
      if (type === 'x-delayed-message' && !this.broker.delayedPlugin) {
        // RabbitMQ 3.13 answers with a channel-level 406 (verified against a real broker).
        this.refuse(406, 'PRECONDITION-FAILED', "PRECONDITION_FAILED - unknown exchange type 'x-delayed-message'");
      }
      this.broker.asserts.push(name);
      const existing = this.broker.exchanges.get(name);
      if (existing && existing !== type) {
        this.refuse(406, 'PRECONDITION-FAILED', `PRECONDITION_FAILED - inequivalent arg 'type' for exchange '${name}': received '${type}' but current is '${existing}'`);
      }
      this.broker.exchanges.set(name, type);
      return { exchange: name };
    });
  }

  checkExchange(name: string) {
    return this.rpc(() => {
      if (!this.broker.exchanges.has(name)) this.refuse(404, 'NOT-FOUND', `NOT_FOUND - no exchange '${name}' in vhost '/test'`);
      return {};
    });
  }

  deleteExchange(name: string) {
    return this.rpc(() => {
      this.broker.exchanges.delete(name);
      return {};
    });
  }

  bindExchange(dest: string, source: string, _pattern?: string) {
    return this.rpc(() => {
      for (const name of [source, dest]) {
        if (!this.broker.exchanges.has(name)) this.refuse(404, 'NOT-FOUND', `NOT_FOUND - no exchange '${name}' in vhost '/test'`);
      }
      this.broker.bindings.push({ source, dest });
      return {};
    });
  }

  assertQueue(queue: string, _options?: any) {
    return this.rpc(() => {
      if (this.broker.queueConflicts.has(queue)) {
        this.refuse(406, 'PRECONDITION-FAILED', `PRECONDITION_FAILED - inequivalent arg 'x-queue-type' for queue '${queue}'`);
      }
      this.broker.queues.add(queue);
      return { queue };
    });
  }

  bindQueue(queue: string, exchange: string, _pattern?: string) {
    return this.rpc(() => {
      if (!this.broker.exchanges.has(exchange)) this.refuse(404, 'NOT-FOUND', `NOT_FOUND - no exchange '${exchange}' in vhost '/test'`);
      this.broker.bindings.push({ source: exchange, dest: `queue:${queue}` });
      return {};
    });
  }

  consume(queue: string, handler: (msg: any) => void, _options?: any) {
    return this.rpc(() => {
      this.consumers.set(queue, handler);
      return { consumerTag: `ctag-${queue}` };
    });
  }

  cancel(consumerTag: string) {
    return this.rpc(() => {
      for (const queue of [...this.consumers.keys()]) {
        if (`ctag-${queue}` === consumerTag) this.consumers.delete(queue);
      }
      return { consumerTag };
    });
  }

  ack(message: any) {
    this.guard();
    this.acks.push(message);
  }

  nack(message: any, _allUpTo = false, requeue = true) {
    this.guard();
    this.nacks.push({ message, requeue });
  }

  publish(exchange: string, routingKey: string, content: Buffer, options: any = {}, cb?: (err: Error | null) => void) {
    this.guard();
    if (this.confirm) this.unconfirmed.push(cb ?? (() => undefined));
    this.broker.published.push({ channel: this.id, exchange, routingKey, content: JSON.parse(content.toString()), options });
    setImmediate(() => {
      if (this.closed) return;
      if (exchange !== '' && !this.broker.exchanges.has(exchange)) {
        this.serverClose(404, `NOT_FOUND - no exchange '${exchange}' in vhost '/test'`);
        return;
      }
      const routable =
        exchange === ''
          ? this.broker.queues.has(routingKey) || routingKey === 'amq.rabbitmq.reply-to'
          : this.broker.bindings.some((b) => b.source === exchange);
      if (options.mandatory && !routable) {
        this.emit('return', { fields: { exchange, routingKey, replyCode: 312 }, properties: options, content });
      }
      if (this.confirm && !this.broker.holdConfirms) this.unconfirmed.shift()?.(null);
    });
    return true;
  }

  sendToQueue(queue: string, content: Buffer, options?: any, cb?: (err: Error | null) => void) {
    return this.publish('', queue, content, options, cb);
  }

  async close() {
    this.guard();
    this.forceClose();
  }

  /** The broker closes this channel (channel.close frame). */
  serverClose(code: number, text: string) {
    if (this.closed) return;
    this.broker.serverCloses.push({ channel: this.id, code, text });
    const err: any = new Error(`Channel closed by server: ${code} with message "${text}"`);
    err.code = code;
    this.emit('error', err);
    this.forceClose();
  }

  forceClose() {
    if (this.closed) return;
    this.closed = true;
    let cb: ((err: Error | null) => void) | undefined;
    while ((cb = this.unconfirmed.shift())) cb(new Error('channel closed'));
    this.emit('close');
  }

  deliver(queue: string, payload: unknown, properties: Record<string, unknown> = {}) {
    const handler = this.consumers.get(queue);
    if (!handler) throw new Error(`no consumer on ${queue}`);
    const message = {
      content: Buffer.from(typeof payload === 'string' ? payload : JSON.stringify(payload)),
      fields: { deliveryTag: ++this.tag, routingKey: queue, exchange: '' },
      properties: { headers: {}, ...properties },
    };
    handler(message);
    return message;
  }

  /** The broker cancels the consumer, e.g. because its queue was deleted. */
  cancelFromBroker(queue: string) {
    const handler = this.consumers.get(queue);
    this.consumers.delete(queue);
    handler?.(null);
  }
}

export class FakeConnection extends EventEmitter {
  closed = false;

  constructor(readonly broker: FakeBroker, readonly name = '') {
    super();
    broker.connections.push(this);
  }

  async createChannel() {
    return this.open('createChannel', false);
  }

  async createConfirmChannel() {
    return this.open('createConfirmChannel', true);
  }

  private open(method: 'createChannel' | 'createConfirmChannel', confirm: boolean) {
    const failure = this.broker.failNext[method];
    if (failure) {
      delete this.broker.failNext[method];
      throw failure;
    }
    if (this.closed) throw new IllegalOperationError('Connection closed');
    const channel = new FakeChannel(this.broker, this, this.broker.channels.length + 1, confirm);
    this.broker.channels.push(channel);
    return channel;
  }

  async close() {
    this.shutdown();
  }

  /** The TCP connection goes away. */
  drop() {
    this.shutdown();
  }

  /** A connection-level error from the broker (e.g. a 320 CONNECTION_FORCED when an operator closes it). */
  hardClose(code: number, text: string) {
    if (this.closed) return;
    const err: any = new Error(`Connection closed: ${code} with message "${text}"`);
    err.code = code;
    this.emit('error', err);
    this.shutdown();
  }

  private shutdown() {
    if (this.closed) return;
    this.closed = true;
    for (const channel of this.broker.channels) {
      if (channel.connection === this) channel.forceClose();
    }
    this.emit('close');
  }
}
