/**
 * Message class for routing slip activity compensate operation
 */

export class RoutingSlipActivityCompensateMessage<TLog = any> {
    trackingNumber: string;
    activityName: string;
    compensationLog: TLog;
    variables: Record<string, any>;
    timestamp: Date;
    correlationId?: string;

    constructor(data?: Partial<RoutingSlipActivityCompensateMessage<TLog>>) {
        if (data) {
            Object.assign(this, data);
        }
    }
}
