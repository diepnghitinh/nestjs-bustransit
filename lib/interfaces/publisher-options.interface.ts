import {Observable} from "rxjs";

/**
 * Publisher-level reliability settings (configured once on the bus).
 */
export interface IPublisherOptions {
    /**
     * Wait for the broker to confirm (ack) every Publish. Default: false (fire-and-forget).
     */
    confirm?: boolean;
    /**
     * Max time to wait for the broker confirm, in milliseconds. Default: 5000.
     */
    confirmTimeoutMs?: number;
    /**
     * Retry policy applied when a publish fails (channel closed, nack, confirm timeout).
     */
    retry?: {
        retryType: any;
        retryValue: any;
        pipe: <T>(source: Observable<T>) => Observable<T>;
    };
}

/**
 * Per-call overrides for Publish().
 */
export interface IPublishOptions {
    /**
     * Override the bus-level confirm setting for this message.
     */
    confirm?: boolean;
    /**
     * Override the bus-level confirm timeout for this message.
     */
    confirmTimeoutMs?: number;
    /**
     * Set false to skip the bus-level retry policy for this message.
     */
    retry?: boolean;
}
