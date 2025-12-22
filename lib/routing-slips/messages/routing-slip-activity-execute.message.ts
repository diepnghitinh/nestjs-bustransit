/**
 * Message class for routing slip activity execute operation
 */

export class RoutingSlipActivityExecuteMessage<TArguments = any> {
    trackingNumber: string;
    activityName: string;
    executionId: string;
    args: TArguments;
    variables: Record<string, any>;
    timestamp: Date;
    correlationId?: string;

    constructor(data?: Partial<RoutingSlipActivityExecuteMessage<TArguments>>) {
        if (data) {
            Object.assign(this, data);
        }
    }
}
