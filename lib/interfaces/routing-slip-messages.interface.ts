/**
 * Message interfaces for distributed routing slip execution
 * These messages are sent to activity queues for execute/compensate operations
 */

/**
 * Message sent to activity execute queue
 */
export interface IRoutingSlipActivityExecuteMessage<TArguments = any> {
    /**
     * Routing slip tracking number
     */
    trackingNumber: string;

    /**
     * Activity name
     */
    activityName: string;

    /**
     * Execution ID for tracking
     */
    executionId: string;

    /**
     * Activity arguments
     */
    args: TArguments;

    /**
     * Current routing slip variables
     */
    variables: Record<string, any>;

    /**
     * Timestamp when message was sent
     */
    timestamp: Date;

    /**
     * Correlation ID for request/reply pattern
     */
    correlationId?: string;
}

/**
 * Message sent to activity compensate queue
 */
export interface IRoutingSlipActivityCompensateMessage<TLog = any> {
    /**
     * Routing slip tracking number
     */
    trackingNumber: string;

    /**
     * Activity name
     */
    activityName: string;

    /**
     * Compensation log from execute phase
     */
    compensationLog: TLog;

    /**
     * Current routing slip variables
     */
    variables: Record<string, any>;

    /**
     * Timestamp when message was sent
     */
    timestamp: Date;

    /**
     * Correlation ID for request/reply pattern
     */
    correlationId?: string;
}

/**
 * Response message from activity execute operation
 */
export interface IRoutingSlipActivityExecuteResponse {
    /**
     * Routing slip tracking number
     */
    trackingNumber: string;

    /**
     * Activity name
     */
    activityName: string;

    /**
     * Execution ID
     */
    executionId: string;

    /**
     * Success or failure
     */
    success: boolean;

    /**
     * Result type: Complete, Fault, Terminate
     */
    resultType: 'Complete' | 'Fault' | 'Terminate';

    /**
     * Compensation log (if successful)
     */
    compensationLog?: any;

    /**
     * Variables to merge (if successful)
     */
    variables?: Record<string, any>;

    /**
     * Error message (if failed)
     */
    error?: {
        message: string;
        stack?: string;
    };

    /**
     * Execution duration in milliseconds
     */
    duration: number;

    /**
     * Timestamp
     */
    timestamp: Date;

    /**
     * Correlation ID for request/reply pattern
     */
    correlationId?: string;
}

/**
 * Response message from activity compensate operation
 */
export interface IRoutingSlipActivityCompensateResponse {
    /**
     * Routing slip tracking number
     */
    trackingNumber: string;

    /**
     * Activity name
     */
    activityName: string;

    /**
     * Success or failure
     */
    success: boolean;

    /**
     * Error message (if failed)
     */
    error?: {
        message: string;
        stack?: string;
    };

    /**
     * Timestamp
     */
    timestamp: Date;

    /**
     * Correlation ID for request/reply pattern
     */
    correlationId?: string;
}
