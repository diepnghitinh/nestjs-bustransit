export type ConsumerStatus = 'starting' | 'consuming' | 'restarting' | 'stopped';

export interface BusTransitHealth {
    /** Connected to the broker and ready to publish. */
    connected: boolean;
    /** The broker is blocking publishers (memory or disk alarm). */
    blocked: boolean;
    /** State of the consumer of each queue. */
    consumers: Record<string, ConsumerStatus>;
}
