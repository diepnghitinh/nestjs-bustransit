import { Logger } from '@nestjs/common';
import type { Channel } from 'amqplib';
import { isNotFound } from './errors';

/**
 * Declares topology on throwaway channels, so a refused declaration (404 on a deleted queue, 406 on an
 * exchange that exists with other settings) never closes a channel the application uses, and the
 * publisher's declaration caches are never touched. After a channel-closing error the next step opens
 * a fresh channel.
 */
export class TopologyRefreshSession {
    private channel: Channel | null = null;
    private ended = false;

    constructor(private readonly open: () => Promise<Channel>) {}

    /** Runs one step; a failure is logged once at warn and never thrown. */
    async attempt(label: string, step: () => Promise<void>): Promise<void> {
        if (this.ended) return;
        try {
            await step();
        } catch (err) {
            this.discard();
            if (this.ended) return; // abandoned: the failure is only the channel being closed under the step
            Logger.warn(`[RabbitMQ] Topology refresh: ${label} failed: ${err?.message ?? err}`);
        }
    }

    /** Uses the exchange as it is when it exists (any type), like the publish path; asserts it only when it is missing. */
    async exchangeIfMissing(exchange: string, assert: (channel: Channel) => Promise<unknown>): Promise<void> {
        try {
            await (await this.current()).checkExchange(exchange);
            return;
        } catch (err) {
            if (!isNotFound(err)) throw err;
            this.discard(); // the broker closed the channel with the 404
        }
        await assert(await this.current());
    }

    async bindExchange(destination: string, source: string): Promise<void> {
        await (await this.current()).bindExchange(destination, source, '');
    }

    async bindQueue(queue: string, exchange: string): Promise<void> {
        await (await this.current()).bindQueue(queue, exchange, '');
    }

    /** Closes the channel in use; later steps do nothing. */
    async end(): Promise<void> {
        this.ended = true;
        this.discard();
    }

    private async current(): Promise<Channel> {
        if (this.ended) throw new Error('the refresh ended');
        if (!this.channel) {
            const channel = await this.open();
            if (this.ended) {
                channel.close().catch(() => undefined); // opened after the refresh was abandoned
                throw new Error('the refresh ended');
            }
            channel.on('error', () => undefined); // reported by the failing step
            this.channel = channel;
        }
        return this.channel;
    }

    private discard(): void {
        const channel = this.channel;
        this.channel = null;
        channel?.close().catch(() => undefined);
    }
}
