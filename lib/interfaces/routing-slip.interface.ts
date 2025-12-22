/**
 * Routing Slip Interfaces
 * Based on MassTransit's Routing Slips pattern for distributed transaction coordination
 */

/**
 * Variable stored in a routing slip
 */
export interface IRoutingSlipVariable {
    key: string;
    value: any;
}

/**
 * Activity in the routing slip itinerary
 */
export interface IRoutingSlipActivity {
    name: string;
    address: string;
    args: any;
}

/**
 * Activity execution log for compensation
 */
export interface IActivityLog {
    activityName: string;
    timestamp: Date;
    duration?: number;
    compensationLog?: any;
}

/**
 * Exception information for faulted routing slips
 */
export interface IActivityException {
    activityName: string;
    timestamp: Date;
    exceptionInfo: {
        message: string;
        stackTrace?: string;
        innerException?: any;
    };
}

/**
 * Main Routing Slip structure
 */
export interface IRoutingSlip {
    trackingNumber: string;
    createTimestamp: Date;
    itinerary: IRoutingSlipActivity[];
    activityLogs: IActivityLog[];
    compensateLogs: IActivityLog[];
    variables: Map<string, any>;
    activityExceptions: IActivityException[];
}

/**
 * Itinerary builder for adding activities
 */
export interface IRoutingSlipItinerary {
    activities: IRoutingSlipActivity[];
    addActivity(name: string, address: string, args: any): void;
}
