/**
 * Response message class for routing slip activity compensate operation
 */

export class RoutingSlipActivityCompensateResponseMessage {
    trackingNumber: string;
    activityName: string;
    success: boolean;
    error?: {
        message: string;
        stack?: string;
    };
    timestamp: Date;
    correlationId?: string;

    constructor(data?: Partial<RoutingSlipActivityCompensateResponseMessage>) {
        if (data) {
            Object.assign(this, data);
        }
    }
}
