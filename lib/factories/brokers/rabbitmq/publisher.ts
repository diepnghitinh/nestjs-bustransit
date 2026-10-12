import { Logger } from '@nestjs/common';
import type { Channel, ConfirmChannel, Message, Options } from 'amqplib';
import { randomUUID } from 'crypto';
import { withTimeout } from '../../../utils/deferred';
import type { ConnectionManager } from './connection-manager';
import type { ReliabilityOptions } from './reliability-options';
import { isNotFound } from './errors';
import { TopologyRefreshSession } from './topology-refresh';

export const PRODUCER_CHANNEL = '_producer';
export const TOPOLOGY_CHANNEL = '_topology';

/**
 * Publishes with publisher confirms on the "_producer" channel and declares exchanges and queues on a
 * separate "_topology" channel, so a refused declaration never closes the channel that carries
 * other messages.
 *
 * Before the first publish to an exchange it checks that the exchange exists (passive declare) and
 * creates it only when it is missing. An exchange that already exists is used as it is, whatever its
 * type or arguments, exactly as 0.3.x did: asserting it with our own arguments could turn a publish
 * that used to work into a 406.
 */
export class Publisher {
    private readonly declaredExchanges = new Set<string>();
    private readonly pendingDeclarations = new Map<string, Promise<void>>();
    private readonly declaredQueues = new Set<string>();
    /** Mandatory publishes whose unroutable return must reject, by messageId. Filled before the publish, so a return that precedes the confirm is seen. */
    private readonly watchedReturns = new Map<string, { returned: boolean }>();
    private readonly closeReasons = new WeakMap<Channel, Error>();
    private declarationGeneration = 0;

    constructor(
        private readonly connection: ConnectionManager,
        private readonly reliability: ReliabilityOptions,
    ) {
        connection.onChannelLost((name) => {
            if (name !== PRODUCER_CHANNEL) return;
            // A closed producer channel usually means 404: an exchange this cache believed in is gone.
            this.forgetDeclarations();
            Logger.warn('[RabbitMQ] Producer channel closed; a new one opens on the next publish');
        });
        connection.onDisconnected(() => this.forgetDeclarations());
    }

    async open(): Promise<void> {
        await this.producerChannel();
    }

    async publishToExchange(exchange: string, body: unknown, options: Options.Publish = {}): Promise<void> {
        await this.connection.whenReady();
        const budget = this.reliability.publishTimeoutMs;
        const startedAt = Date.now();
        // The declaration step counts against the same budget: a stalled broker must not hang the caller.
        await withTimeout(
            this.ensurePublishTarget(exchange),
            budget,
            `[RabbitMQ] Publish to '${exchange}' could not declare the exchange within ${budget}ms`,
        );
        const remaining = Math.max(1, budget - (Date.now() - startedAt));
        await this.confirmPublish(exchange, '', body, { persistent: true, mandatory: true, ...options }, remaining);
    }

    /**
     * Publishes without declaring anything. With `rejectIfUnroutable` (use it with `mandatory`), the
     * publish rejects when the broker returns the message as unroutable, instead of resolving.
     */
    async publishRaw(
        exchange: string,
        routingKey: string,
        body: unknown,
        options: Options.Publish & { rejectIfUnroutable?: boolean } = {},
    ): Promise<void> {
        await this.connection.whenReady();
        const { rejectIfUnroutable, ...publishOptions } = options;
        await this.confirmPublish(exchange, routingKey, body, publishOptions, this.reliability.publishTimeoutMs, rejectIfUnroutable);
    }

    /** Uses an existing exchange as it is; creates a durable fanout exchange only when it is missing. */
    private ensurePublishTarget(exchange: string): Promise<void> {
        return this.declareOnce(exchange, async (channel) => {
            if (await this.exchangeExists(exchange)) return;
            await channel.assertExchange(exchange, 'fanout', { durable: true });
        });
    }

    /**
     * Passive check on a throwaway channel: the broker closes the channel when a 404 happens, so it must not be a shared one.
     * The answer is not cached: trusting a stale "yes" would publish into a deleted exchange and the 404 would close the
     * shared producer channel. A negative answer drops the exchange from the declaration cache, so the next declaration
     * really asserts it again. Bounded by publishTimeoutMs.
     */
    async exchangeExists(exchange: string): Promise<boolean> {
        const budget = this.reliability.publishTimeoutMs;
        const exists = await withTimeout(
            this.checkExchange(exchange),
            budget,
            `[RabbitMQ] Could not check exchange '${exchange}' within ${budget}ms`,
        );
        if (!exists) this.forgetExchange(exchange);
        return exists;
    }

    private async checkExchange(exchange: string): Promise<boolean> {
        const channel = await this.requireConnection().createChannel();
        channel.on('error', () => undefined); // a 404 here is the expected answer for a missing exchange
        try {
            await channel.checkExchange(exchange);
            return true;
        } catch (err) {
            if (isNotFound(err)) return false;
            throw err;
        } finally {
            await channel.close().catch(() => undefined);
        }
    }

    /** A session that declares on throwaway channels only: it touches neither the shared channels nor the declaration caches. */
    createRefreshSession(): TopologyRefreshSession {
        return new TopologyRefreshSession(() => this.requireConnection().createChannel());
    }

    /** Drops one exchange from the caches, so the next declaration asserts it on the broker again. */
    forgetExchange(exchange: string): void {
        this.declaredExchanges.delete(exchange);
    }

    /**
     * Topology declarations for consumers: like the publish path, an exchange that exists is used as it is
     * (any type, any arguments) and a durable fanout exchange is created only when it is missing, so a
     * conflicting exchange never gives a 406 that would close the shared topology channel.
     */
    ensureExchange(exchange: string): Promise<void> {
        return this.ensurePublishTarget(exchange);
    }

    declareDelayedExchange(exchange: string): Promise<void> {
        return this.declareOnce(exchange, (channel) =>
            channel.assertExchange(exchange, 'x-delayed-message', {
                autoDelete: false,
                durable: true,
                arguments: { 'x-delayed-type': 'direct' },
            }),
        );
    }

    /** Declares once per connection; concurrent callers share one declaration. */
    private declareOnce(exchange: string, declare: (channel: Channel) => Promise<unknown>): Promise<void> {
        if (this.declaredExchanges.has(exchange)) return Promise.resolve();
        const inFlight = this.pendingDeclarations.get(exchange);
        if (inFlight) return inFlight;
        const generation = this.declarationGeneration;
        const declaration = this.topologyChannel()
            .then(declare)
            .then(() => {
                // Only cache if generation hasn't changed (forgetDeclarations was not called)
                if (generation === this.declarationGeneration) {
                    this.declaredExchanges.add(exchange);
                }
            })
            .finally(() => {
                // Only remove pending if it's still the same promise
                if (this.pendingDeclarations.get(exchange) === declaration) {
                    this.pendingDeclarations.delete(exchange);
                }
            });
        this.pendingDeclarations.set(exchange, declaration);
        return declaration;
    }

    /** Binds on the topology channel: a refused bind never closes a consumer's channel. */
    async bindQueue(queue: string, exchange: string): Promise<void> {
        const channel = await this.topologyChannel();
        await channel.bindQueue(queue, exchange, '');
    }

    async bindExchange(destination: string, source: string): Promise<void> {
        const channel = await this.topologyChannel();
        await channel.bindExchange(destination, source, '');
    }

    /** Bounded by publishTimeoutMs, like the rest of the publish path: a stalled broker must not hang the caller. */
    async ensureQueue(queue: string): Promise<void> {
        if (this.declaredQueues.has(queue)) return;
        const budget = this.reliability.publishTimeoutMs;
        await withTimeout(
            this.topologyChannel().then((channel) => channel.assertQueue(queue, { durable: true })),
            budget,
            `[RabbitMQ] Could not declare queue '${queue}' within ${budget}ms`,
        );
        this.declaredQueues.add(queue);
    }

    private forgetDeclarations(): void {
        this.declaredExchanges.clear();
        this.declaredQueues.clear();
        this.pendingDeclarations.clear();
        this.declarationGeneration++;
    }

    private requireConnection() {
        const connection = this.connection.current;
        if (!connection) throw new Error('[RabbitMQ] Not connected to broker');
        return connection;
    }

    private topologyChannel(): Promise<Channel> {
        return this.connection.channels.getOrCreate(TOPOLOGY_CHANNEL, async (track) => {
            const channel = track(await this.requireConnection().createChannel());
            channel.on('error', (err: any) => {
                Logger.error(`[RabbitMQ] Declaration refused by the broker: ${err.message}`);
            });
            return channel;
        });
    }

    private producerChannel(): Promise<ConfirmChannel> {
        return this.connection.channels.getOrCreate(PRODUCER_CHANNEL, async (track) => {
            const channel = track(await this.requireConnection().createConfirmChannel());
            channel.on('error', (err) => {
                this.closeReasons.set(channel, err);
                Logger.error(`[RabbitMQ] Channel error for '${PRODUCER_CHANNEL}': ${err.message}`);
            });
            channel.on('return', (returned: Message) => {
                const watched = returned.properties.messageId ? this.watchedReturns.get(returned.properties.messageId) : undefined;
                if (watched) watched.returned = true;
                const messageId = returned.properties.messageId ? ` ${returned.properties.messageId}` : '';
                Logger.warn(
                    `[RabbitMQ] Unroutable message${messageId} to exchange ` +
                    `'${returned.fields.exchange}' (routing key '${returned.fields.routingKey}'): ` +
                    'no queue is bound, the message was dropped',
                );
            });
            return channel;
        });
    }

    private async confirmPublish(
        exchange: string,
        routingKey: string,
        body: unknown,
        options: Options.Publish,
        timeoutMs: number,
        rejectIfUnroutable = false,
    ): Promise<void> {
        // The budget starts before the producer channel is opened: opening it can stall too (e.g. a blocked broker).
        // A channel that opens after the deadline is simply kept for the next publish.
        const deadline = Date.now() + timeoutMs;
        const notConfirmed = () => {
            const blocked = this.connection.isBlocked ? ' (the broker is blocking publishers)' : '';
            return new Error(`[RabbitMQ] Publish to '${exchange || `queue ${routingKey}`}' was not confirmed within ${this.reliability.publishTimeoutMs}ms${blocked}`);
        };
        let openTimer: NodeJS.Timeout | undefined;
        const channel = await Promise.race([
            this.producerChannel(),
            new Promise<never>((_, reject) => {
                openTimer = setTimeout(() => reject(notConfirmed()), timeoutMs);
            }),
        ]).finally(() => clearTimeout(openTimer));
        // basic.return arrives before basic.ack, so a per-publish marker tells the confirm callback about it.
        let watchedId: string | undefined;
        let watch: { returned: boolean } | undefined;
        if (rejectIfUnroutable) {
            watchedId = options.messageId ?? randomUUID();
            options = { ...options, messageId: watchedId };
            watch = { returned: false };
            this.watchedReturns.set(watchedId, watch);
        }
        const content = Buffer.from(JSON.stringify(body), 'utf-8');
        const target = exchange || `queue ${routingKey}`;
        let timer: NodeJS.Timeout | undefined;
        try {
            await new Promise<void>((resolve, reject) => {
                timer = setTimeout(() => reject(notConfirmed()), Math.max(1, deadline - Date.now()));
                channel.publish(exchange, routingKey, content, options, (err) => {
                    if (!err) {
                        if (!watch?.returned) return resolve();
                        if (!exchange) this.declaredQueues.delete(routingKey); // the queue is gone: assert it again next time
                        return reject(new Error(`[RabbitMQ] Message to '${target}' was returned as unroutable by the broker`));
                    }
                    // amqplib reports "channel closed"; the broker's reason (e.g. 404 NOT_FOUND) is more useful.
                    reject(
                        this.closeReasons.get(channel) ??
                        new Error(
                            `[RabbitMQ] The producer channel closed before the broker confirmed the message ` +
                            `(${err.message}; the connection was lost?). It may or may not have been delivered.`,
                        ),
                    );
                });
            });
        } finally {
            clearTimeout(timer);
            if (watchedId) this.watchedReturns.delete(watchedId);
        }
    }
}
