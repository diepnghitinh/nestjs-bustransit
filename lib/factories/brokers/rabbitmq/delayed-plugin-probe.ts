import * as amqp from 'amqplib';
import type { ChannelModel, Options } from 'amqplib';
import { withTimeout } from '../../../utils/deferred';
import { CLOSE_TIMEOUT_MS, closeOrDestroy } from './connection-manager';

/**
 * Checks for the x-delayed-message plugin on a throwaway connection, with a time limit.
 *
 * Without the plugin, RabbitMQ 3.13 refuses the declaration with a channel-level 406. Using a separate
 * connection keeps the probe away from the main connection whatever the broker version does, and the
 * time limit keeps a hung probe from blocking start-up.
 */
export async function probeDelayedMessagePlugin(
    connectOptions: Options.Connect,
    connectionName: string,
    timeoutMs: number,
    signal?: AbortSignal,
): Promise<boolean> {
    let connection: ChannelModel | null = null;
    // The socket gets its own controller: the caller's abort reaches it only while the probe is pending,
    // so a shutdown during the graceful close that follows a 406 does not destroy that close.
    const socketAbort = new AbortController();
    const forward = () => socketAbort.abort();
    if (signal?.aborted) forward();
    else signal?.addEventListener('abort', forward, { once: true });
    const connecting = amqp.connect(connectOptions, {
        clientProperties: { connection_name: `${connectionName}:probe` },
        // Also bound the TCP connect, so a packet-dropping broker cannot keep the process alive.
        timeout: timeoutMs,
        // net.connect honours an abort signal, so shutdown can cancel a handshake that never answers.
        signal: socketAbort.signal,
    });
    connecting.catch(() => undefined);
    const run = async (): Promise<boolean> => {
        connection = await connecting;
        connection.on('error', () => undefined);
        const channel = await connection.createChannel();
        channel.on('error', () => undefined);
        const exchange = `_bustransit_probe_delayed_${process.pid}_${Date.now()}`;
        await channel.assertExchange(exchange, 'x-delayed-message', {
            autoDelete: true,
            durable: false,
            arguments: { 'x-delayed-type': 'direct' },
        });
        await channel.deleteExchange(exchange);
        return true;
    };

    let timer: NodeJS.Timeout | undefined;
    let onAbort: (() => void) | undefined;
    let outcome: 'answered' | 'timed out' | 'aborted' = 'answered';
    try {
        // The time limit covers the connect and the channel operations; an abort (shutdown) ends it early.
        const limit = new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error('probe timed out')), timeoutMs);
            onAbort = () => reject(new Error('probe aborted'));
            if (signal?.aborted) onAbort();
            else signal?.addEventListener('abort', onAbort, { once: true });
        });
        const running = run();
        running.catch(() => undefined);
        return await Promise.race([running, limit]);
    } catch (err) {
        const message = (err as Error)?.message;
        if (message === 'probe timed out') outcome = 'timed out';
        else if (message === 'probe aborted') outcome = 'aborted';
        // A connection that opens after the verdict must still be closed.
        if (!connection) {
            void connecting
                .then((late) => (outcome === 'answered' ? closeOrDestroy(late, CLOSE_TIMEOUT_MS) : closeOrDestroy(late, 0)))
                .catch(() => undefined);
        }
        return false;
    } finally {
        clearTimeout(timer);
        if (onAbort) signal?.removeEventListener('abort', onAbort);
        // From here on the caller's abort must not touch the socket (a graceful close may be running).
        signal?.removeEventListener('abort', forward);
        const open = connection as ChannelModel | null;
        if (open) {
            if (outcome === 'aborted') {
                // Shutting down: drop the socket quietly. The signal normally did it already.
                open.on('error', () => undefined);
                const socket = (open as unknown as { connection?: { stream?: { destroy?: (err?: Error) => void } } }).connection?.stream;
                socket?.destroy?.(new Error('[RabbitMQ] The probe was aborted by shutdown'));
            } else {
                // After a timeout the broker is not answering: drop the socket at once. After any other
                // failure (e.g. the 406 of a broker without the plugin) close gracefully.
                await closeOrDestroy(open, outcome === 'timed out' ? 0 : CLOSE_TIMEOUT_MS);
            }
        }
    }
}
