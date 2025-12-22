/**
 * Response message class for routing slip activity execute operation
 */

export class RoutingSlipActivityExecuteResponseMessage {
    trackingNumber: string;
    activityName: string;
    executionId: string;
    success: boolean;
    resultType: 'Complete' | 'Fault' | 'Terminate';
    compensationLog?: any;
    variables?: Record<string, any>;
    error?: {
        message: string;
        stack?: string;
    };
    duration: number;
    timestamp: Date;
    correlationId?: string;

    constructor(data?: Partial<RoutingSlipActivityExecuteResponseMessage>) {
        if (data) {
            Object.assign(this, data);
        }
    }
}
