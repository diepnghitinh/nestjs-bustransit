import { Logger } from '@nestjs/common';
import type { Channel, ConsumeMessage } from 'amqplib';
import type { ConsumerStatus } from '../../../interfaces/brokers/bustransit-health.interface';
import { withTimeout } from '../../../utils/deferred';
import type { ConnectionManager } from './connection-manager';
import type { DeliveryHandler } from './delivery-pipeline';
import type { ReliabilityOptions } from './reliability-options';

export interface ConsumerDefinition {
    queue: string;
    prefetch: number;
    /** Runs on the consumer's own channel before consuming: queue, bindings, redelivery. */
    prepare: (channel: Channel) => Promise<void>;
    handle: DeliveryHandler;
}

/**
 * Runs the consumer of one queue on its own channel. A failure here (refused declaration, channel
 * closed or consumer cancelled by the broker) restarts this consumer only, with a doubling delay.
 */
export class ConsumerRunner {
    private state: ConsumerStatus = 'stopped';
    private channel: Channel | null = null;
    private consumerTag: string | null = null;
    private stopping = false;
    private stopped: Promise<void> | null = null;
    private restartTimer: NodeJS.Timeout | null = null;
    private restartDelay: number;
    private attempt = 0; // bumped by every event that makes an in-flight start() obsolete
    private readonly inFlight = new Set<Promise<void>>();

    constructor(
        private readonly def: ConsumerDefinition,
        private readonly connection: ConnectionManager,
        private readonly reliability: ReliabilityOptions,
    ) {
        this.restartDelay = reliability.reconnectDelayMs;
        connection.onChannelLost((name) => {
            if (name === this.channelName) this.handleLost();
        });
        connection.onDisconnected(() => {
            // The connection setup starts every consumer again once it reconnects.
            ++this.attempt;
            this.clearRestart();
            this.channel = null;
            this.consumerTag = null;
            this.state = 'stopped';
        });
    }

    get status(): ConsumerStatus {
        return this.state;
    }

    private get channelName(): string {
        return `consumer:${this.def.queue}`;
    }

    async start(): Promise<void> {
        if (this.stopping || this.state === 'starting' || this.state === 'consuming') return;
        const attempt = ++this.attempt;
        this.clearRestart();
        this.state = 'starting';
        let channel: Channel | null = null;
        try {
            channel = await this.connection.channels.getOrCreate(this.channelName, (track) => this.openChannel(track));
            if (attempt !== this.attempt) return;
            await this.def.prepare(channel);
            if (attempt !== this.attempt) return;
            const opened = channel;
            const { consumerTag } = await opened.consume(this.def.queue, (message) => this.dispatch(opened, message), { noAck: false });
            if (attempt !== this.attempt || this.connection.channels.get(this.channelName) !== opened) {
                await opened.cancel(consumerTag).catch(() => undefined);
                if (this.stopping) this.state = 'stopped';
                return;
            }
            this.channel = opened;
            this.consumerTag = consumerTag;
            this.state = 'consuming';
            this.restartDelay = this.reliability.reconnectDelayMs;
            Logger.log(`[RabbitMQ] Consuming '${this.def.queue}'`);
        } catch (err) {
            if (attempt !== this.attempt) return;
            if (this.stopping) {
                this.state = 'stopped';
                return;
            }
            Logger.error(`[RabbitMQ] Could not start the consumer of '${this.def.queue}': ${err.message}`);
            this.state = 'restarting';
            if (channel) await channel.close().catch(() => undefined);
            this.scheduleRestart();
        }
    }

    /** Idempotent: a second call returns the first call's promise, so the drain never waits twice. */
    stop(timeoutMs: number): Promise<void> {
        if (!this.stopped) this.stopped = this.drain(timeoutMs);
        return this.stopped;
    }

    private async drain(timeoutMs: number): Promise<void> {
        const deadline = Date.now() + timeoutMs;
        const remaining = () => Math.max(0, deadline - Date.now());
        ++this.attempt;
        this.stopping = true;
        this.clearRestart();
        const { channel, consumerTag } = this;
        if (channel && consumerTag) {
            // A broker that stopped answering must not hold shutdown past its budget.
            await withTimeout(channel.cancel(consumerTag), remaining(), 'cancel timeout').catch((err) => {
                if (err?.message === 'cancel timeout') {
                    Logger.warn(`[RabbitMQ] The broker did not answer the cancel of '${this.def.queue}' within ${timeoutMs}ms`);
                }
            });
        }
        if (this.inFlight.size > 0) {
            Logger.log(`[RabbitMQ] Waiting for ${this.inFlight.size} message(s) on '${this.def.queue}' before shutdown`);
            try {
                await withTimeout(Promise.allSettled([...this.inFlight]), remaining(), 'drain timeout');
            } catch {
                Logger.warn(
                    `[RabbitMQ] ${this.inFlight.size} message(s) on '${this.def.queue}' were still running after ${timeoutMs}ms; ` +
                    'the broker will redeliver them',
                );
            }
        }
        this.state = 'stopped';
    }

    private async openChannel(track: (channel: Channel) => Channel): Promise<Channel> {
        const connection = this.connection.current;
        if (!connection) throw new Error('[RabbitMQ] Not connected to broker');
        const channel = track(await connection.createChannel());
        channel.on('error', (err) => Logger.error(`[RabbitMQ] Channel error for '${this.def.queue}': ${err.message}`));
        await channel.prefetch(this.def.prefetch);
        return channel;
    }

    private dispatch(channel: Channel, message: ConsumeMessage | null): void {
        if (!message) {
            Logger.warn(`[RabbitMQ] The broker cancelled the consumer of '${this.def.queue}' (was the queue deleted?)`);
            void channel.close().catch(() => undefined);
            return;
        }
        if (this.stopping) {
            // Delivered after shutdown began: hand it back instead of starting work we would not wait for.
            try {
                channel.nack(message, false, true);
            } catch {
                // channel already closed: the broker requeues it anyway
            }
            return;
        }
        const task: Promise<void> = Promise.resolve()
            .then(() => this.def.handle(channel, message))
            .catch((err) => Logger.error(`[RabbitMQ] Unhandled error while handling a message on '${this.def.queue}': ${err.message}`))
            .finally(() => this.inFlight.delete(task));
        this.inFlight.add(task);
    }

    private handleLost(): void {
        ++this.attempt;
        this.channel = null;
        this.consumerTag = null;
        if (this.stopping) {
            this.state = 'stopped';
            return;
        }
        this.scheduleRestart();
    }

    private scheduleRestart(): void {
        if (this.stopping || this.restartTimer) return;
        if (!this.connection.current) {
            this.state = 'stopped';
            return;
        }
        this.state = 'restarting';
        const delay = this.restartDelay;
        this.restartDelay = Math.min(this.restartDelay * 2, this.reliability.consumerRestartMaxDelayMs);
        Logger.debug(`[RabbitMQ] Scheduling a restart of the consumer of '${this.def.queue}' in ${delay}ms`);
        this.restartTimer = setTimeout(() => {
            this.restartTimer = null;
            Logger.warn(`[RabbitMQ] Restarting the consumer of '${this.def.queue}' (waited ${delay}ms)`);
            void this.start();
        }, delay);
    }

    private clearRestart(): void {
        if (this.restartTimer) {
            clearTimeout(this.restartTimer);
            this.restartTimer = null;
        }
    }
}
