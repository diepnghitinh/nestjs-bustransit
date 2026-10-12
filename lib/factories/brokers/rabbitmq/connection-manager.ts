import { Logger } from '@nestjs/common';
import * as amqp from 'amqplib';
import type { ChannelModel, Options } from 'amqplib';
import { createDeferred, Deferred, withTimeout } from '../../../utils/deferred';
import { ChannelRegistry } from './channel-registry';
import type { ReliabilityOptions } from './reliability-options';

/** How long close() waits for a connect still in progress; a connection that opens later is closed at once. */
export const CLOSE_WAIT_FOR_START_MS = 2000;

/** How long close() waits for channels and the connection to close before it drops the socket. */
export const CLOSE_TIMEOUT_MS = 2000;

/**
 * Closes a connection, and drops its socket if the broker has not answered after `ms`.
 *
 * A plain `stream.destroy()` is invisible to amqplib (it only listens to 'end' and 'error'), so its
 * heartbeat timers would keep the process alive; destroying with an error makes it emit error+close
 * and clean up. Never rejects.
 */
export async function closeOrDestroy(connection: ChannelModel, ms: number): Promise<void> {
    connection.on('error', () => undefined); // the error below, or a reset during the close handshake, must not crash the process
    try {
        await withTimeout(connection.close(), Math.max(0, ms), 'close timeout');
    } catch (err) {
        if ((err as Error).message !== 'close timeout') return; // the connection was already closed or broken
        const waited = ms > 0 ? `within ${ms}ms` : 'before the shutdown deadline';
        Logger.warn(`[RabbitMQ] The broker did not answer the close ${waited}; dropping the connection`);
        const socket = (connection as unknown as { connection?: { stream?: { destroy?: (err?: Error) => void } } }).connection?.stream;
        socket?.destroy?.(new Error('[RabbitMQ] The broker did not answer the close; connection dropped'));
    }
}

export type ConnectionSetup = (connection: ChannelModel) => Promise<void>;

/**
 * Owns the broker connection: connects, runs `setup` on every new connection, reconnects after a
 * loss, and tells publishers when they may publish (whenReady).
 */
export class ConnectionManager {
    readonly channels: ChannelRegistry;
    private connection: ChannelModel | null = null;
    private connecting = false;
    private shuttingDown = false;
    private blocked = false;
    private reconnectTimer: NodeJS.Timeout | null = null;
    private ready: Deferred<void> = createDeferred();
    private starting: Promise<void> | null = null;
    private readonly lostListeners: Array<(name: string) => void> = [];
    private readonly disconnectListeners: Array<() => void> = [];

    constructor(
        private readonly connectOptions: Options.Connect,
        private readonly connectionName: string,
        private readonly reliability: ReliabilityOptions,
        private readonly setup: ConnectionSetup,
    ) {
        this.channels = new ChannelRegistry((name) =>
            this.lostListeners.forEach((listener) => {
                try {
                    listener(name);
                } catch (err) {
                    Logger.error(`[RabbitMQ] A connection listener failed: ${err instanceof Error ? err.message : String(err)}`);
                }
            }),
        );
    }

    get current(): ChannelModel | null {
        return this.connection;
    }

    get isConnected(): boolean {
        return this.connection !== null && this.ready.settled;
    }

    get isBlocked(): boolean {
        return this.blocked;
    }

    /**
     * Register a listener for channels closed by the broker. Listeners are also called for channels
     * closed because the whole connection went away (amqplib closes the channels first), and
     * onDisconnected follows in that case.
     */
    onChannelLost(listener: (name: string) => void): void {
        this.lostListeners.push(listener);
    }

    onDisconnected(listener: () => void): void {
        this.disconnectListeners.push(listener);
    }

    start(): Promise<void> {
        // If a start is already in flight, return that promise
        if (this.starting) return this.starting;

        // Start a new attempt and track its promise, clearing it when done
        return (this.starting = this.doStart().finally(() => {
            this.starting = null;
        }));
    }

    private async doStart(): Promise<void> {
        if (this.connecting || this.shuttingDown || this.connection) return;
        this.connecting = true;
        let connection: ChannelModel | null = null;
        try {
            connection = await amqp.connect(this.connectOptions, {
                clientProperties: { connection_name: this.connectionName },
                // A broker that drops packets must not hang the connect until the OS gives up.
                // amqplib clears this socket timeout once the connection is open.
                timeout: this.reliability.readyTimeoutMs,
            });
            if (this.shuttingDown) {
                await closeOrDestroy(connection, CLOSE_TIMEOUT_MS);
                return;
            }
            const opened = connection;
            opened.on('error', (err) => {
                // While shutting down, the only error is our own socket drop (closeOrDestroy), already logged as a warning.
                if (!this.shuttingDown) Logger.error(`[RabbitMQ] Connection error: ${err.message}`);
            });
            opened.on('close', () => this.handleClose(opened));
            opened.on('blocked', (reason) => {
                this.blocked = true;
                Logger.warn(`[RabbitMQ] The broker is blocking publishers: ${reason}`);
            });
            opened.on('unblocked', () => {
                this.blocked = false;
                Logger.log('[RabbitMQ] The broker stopped blocking publishers');
            });
            this.connection = opened;

            await this.setup(opened);
            // The connection may have closed during setup (shutdown, or the broker dropped it);
            // handleClose already scheduled what comes next. Never report a dead connection as ready.
            if (this.connection !== opened) return;

            this.ready.resolve();
            Logger.log('[RabbitMQ] Connected');
        } catch (err) {
            if (this.shuttingDown) {
                if (connection) await closeOrDestroy(connection, CLOSE_TIMEOUT_MS);
                return;
            }
            Logger.error(`[RabbitMQ] Connection setup failed, retrying in ${this.reliability.reconnectDelayMs}ms: ${err.message}`);
            this.forget();
            if (connection) await closeOrDestroy(connection, CLOSE_TIMEOUT_MS);
            this.scheduleReconnect();
        } finally {
            this.connecting = false;
            // If the connection was lost during setup (after handleClose ran), schedule reconnect
            if (!this.connection && !this.shuttingDown) {
                this.scheduleReconnect();
            }
        }
    }

    async whenReady(): Promise<void> {
        if (this.ready.settled) return;
        await withTimeout(
            this.ready.promise,
            this.reliability.readyTimeoutMs,
            `[RabbitMQ] Not connected to broker after ${this.reliability.readyTimeoutMs}ms`,
        );
    }

    async close(): Promise<void> {
        this.shuttingDown = true;
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
        const connection = this.connection;
        this.connection = null;
        // One deadline for everything: closing channels and the connection, and waiting for a start().
        const deadline = Date.now() + CLOSE_TIMEOUT_MS;
        const remaining = () => Math.max(0, deadline - Date.now());
        await withTimeout(this.channels.closeAll(), remaining(), 'close timeout').catch(() => undefined);
        if (connection) await closeOrDestroy(connection, remaining());
        // Wait for an in-flight start(), but not for a connect that never answers: doStart() closes
        // a connection that opens after shutdown began.
        if (this.starting) {
            await withTimeout(this.starting, Math.min(remaining(), CLOSE_WAIT_FOR_START_MS), 'close: connect still pending').catch(() => undefined);
        }
    }

    private handleClose(connection: ChannelModel): void {
        if (connection !== this.connection) return;
        this.forget();
        if (this.shuttingDown) return;
        Logger.warn(`[RabbitMQ] Connection closed, reconnecting in ${this.reliability.reconnectDelayMs}ms`);
        this.scheduleReconnect();
    }

    private forget(): void {
        this.connection = null;
        this.blocked = false;
        this.channels.clear();
        if (this.ready.settled) this.ready = createDeferred();
        this.disconnectListeners.forEach((listener) => {
            try {
                listener();
            } catch (err) {
                Logger.error(`[RabbitMQ] A connection listener failed: ${err instanceof Error ? err.message : String(err)}`);
            }
        });
    }

    private scheduleReconnect(): void {
        if (this.shuttingDown || this.reconnectTimer) return;
        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null;
            void this.start();
        }, this.reliability.reconnectDelayMs);
    }
}
