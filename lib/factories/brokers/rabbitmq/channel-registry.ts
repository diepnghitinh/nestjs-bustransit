import type { Channel } from 'amqplib';

/**
 * AMQP channels of one connection, by name.
 *
 * A channel the broker closes (404, 406, 403 ...) is dead for good in amqplib: every later call on it
 * throws "Channel closed". The registry drops such a channel when it emits "close", so the next
 * getOrCreate() opens a fresh one instead of handing out the dead object.
 */
export class ChannelRegistry {
    private readonly channels = new Map<string, Channel>();
    private readonly pending = new Map<string, Promise<Channel>>();
    /** Incremented when the connection resets (clear()). A creation started before the reset must not register into the new state. */
    private generation = 0;

    constructor(private readonly onLost: (name: string) => void = () => undefined) {}

    get(name: string): Channel | undefined {
        return this.channels.get(name);
    }

    has(name: string): boolean {
        return this.channels.has(name) || this.pending.has(name);
    }

    register<T extends Channel>(name: string, channel: T): T {
        this.channels.set(name, channel);
        channel.once('close', () => {
            if (this.channels.get(name) !== channel) return;
            this.channels.delete(name);
            this.onLost(name);
        });
        return channel;
    }

    /**
     * `create` receives a `track` function: call it on the channel as soon as it exists, before any
     * further await, so a close that happens while `create` is still working is noticed. A channel
     * that closed before it could be registered is never registered; creation is retried once.
     */
    getOrCreate<T extends Channel>(name: string, create: (track: (channel: T) => T) => Promise<T>): Promise<T> {
        const existing = this.channels.get(name);
        if (existing) return Promise.resolve(existing as T);
        const inFlight = this.pending.get(name);
        if (inFlight) return inFlight as Promise<T>;

        const generation = this.generation;
        const attempt = async (retry: boolean): Promise<T> => {
            let closed = false;
            const tracked = new WeakSet<Channel>();
            const track = (channel: T): T => {
                if (!tracked.has(channel)) {
                    tracked.add(channel);
                    channel.once('close', () => {
                        closed = true;
                    });
                }
                return channel;
            };
            const channel = track(await create(track));
            if (generation !== this.generation) {
                channel.close().catch(() => undefined);
                throw new Error('[RabbitMQ] The connection was reset while the channel was opening');
            }
            if (closed) {
                if (retry) return attempt(false);
                throw new Error(`[RabbitMQ] Channel '${name}' closed while it was opening`);
            }
            return this.register(name, channel);
        };

        const created: Promise<T> = attempt(true).finally(() => {
            if (this.pending.get(name) === created) {
                this.pending.delete(name);
            }
        });
        this.pending.set(name, created);
        return created;
    }

    /** Forget every channel without reporting it lost. Used when the whole connection is gone. */
    clear(): void {
        this.channels.clear();
        this.pending.clear();
        this.generation++;
    }

    async closeAll(): Promise<void> {
        const open = [...this.channels.values()];
        this.clear();
        await Promise.all(open.map((channel) => channel.close().catch(() => undefined)));
    }
}
