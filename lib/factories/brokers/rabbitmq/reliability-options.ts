export interface ReliabilityOptions {
    /** Wait before reconnecting, and the first wait before restarting a consumer. */
    reconnectDelayMs: number;
    /** How long a publish or Send waits for the broker connection before failing. */
    readyTimeoutMs: number;
    /** How long a publish waits for the broker to confirm the message. */
    publishTimeoutMs: number;
    /** How long Send waits for a reply. */
    sendTimeoutMs: number;
    /** Ceiling of the doubling delay between consumer restarts. */
    consumerRestartMaxDelayMs: number;
    /** How long shutdown waits for messages in progress. Keep it below the container stop grace period. */
    shutdownTimeoutMs: number;
    /** How often a consuming process declares its exchanges and bindings again, so topology an operator deleted comes back. */
    topologyRefreshMs: number;
}

export const DEFAULT_RELIABILITY: ReliabilityOptions = {
    reconnectDelayMs: 5000,
    readyTimeoutMs: 10000,
    publishTimeoutMs: 10000,
    sendTimeoutMs: 10000,
    consumerRestartMaxDelayMs: 60000,
    shutdownTimeoutMs: 30000,
    topologyRefreshMs: 60000,
};

/** The longest delay a Node timer accepts; a larger one fires after 1 ms. */
export const MAX_TIMER_DELAY_MS = 2147483647;

export function resolveReliability(overrides?: Partial<ReliabilityOptions>): ReliabilityOptions {
    const merged: ReliabilityOptions = { ...DEFAULT_RELIABILITY, ...definedEntries(overrides) };
    for (const [key, value] of Object.entries(merged)) {
        if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
            throw new Error(`[BusTransit] reliability.${key} must be a positive number of milliseconds, got ${value}`);
        }
        if (value > MAX_TIMER_DELAY_MS) {
            throw new Error(
                `[BusTransit] reliability.${key} must be at most ${MAX_TIMER_DELAY_MS} ms (about 24.8 days), got ${value}`,
            );
        }
    }
    return merged;
}

/** Drops `undefined` entries, so `UseReliability({ x: config.get('UNSET') })` keeps the default. */
export function definedEntries(overrides?: Partial<ReliabilityOptions>): Partial<ReliabilityOptions> {
    return Object.fromEntries(Object.entries(overrides ?? {}).filter(([, value]) => value !== undefined)) as Partial<ReliabilityOptions>;
}
