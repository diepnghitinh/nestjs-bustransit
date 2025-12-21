/**
 * Routing Slip Events for monitoring and observability
 * Based on MassTransit's event system
 */

import { IActivityException, IActivityLog, IRoutingSlipVariable } from './routing-slip.interface';

/**
 * Base event for all routing slip events
 */
export interface IRoutingSlipEvent {
    trackingNumber: string;
    timestamp: Date;
    duration?: number;
    variables: Map<string, any>;
}

/**
 * Published when a routing slip completes successfully
 */
export interface IRoutingSlipCompleted extends IRoutingSlipEvent {
    activityLogs: IActivityLog[];
}

/**
 * Published when a routing slip faults
 */
export interface IRoutingSlipFaulted extends IRoutingSlipEvent {
    activityLogs: IActivityLog[];
    activityExceptions: IActivityException[];
}

/**
 * Published when compensation fails
 */
export interface IRoutingSlipCompensationFailed extends IRoutingSlipEvent {
    activityLogs: IActivityLog[];
    compensateLogs: IActivityLog[];
    activityExceptions: IActivityException[];
}

/**
 * Published when an activity completes
 */
export interface IRoutingSlipActivityCompleted extends IRoutingSlipEvent {
    activityName: string;
    executionId: string;
    args: any;
    data: any;
}

/**
 * Published when an activity faults
 */
export interface IRoutingSlipActivityFaulted extends IRoutingSlipEvent {
    activityName: string;
    executionId: string;
    exception: IActivityException;
}

/**
 * Published when an activity is compensated
 */
export interface IRoutingSlipActivityCompensated extends IRoutingSlipEvent {
    activityName: string;
    compensationLog: any;
}

/**
 * Published when routing slip is terminated
 */
export interface IRoutingSlipTerminated extends IRoutingSlipEvent {
    activityLogs: IActivityLog[];
    reason?: string;
}

/**
 * Event subscriber for routing slip events
 */
export interface IRoutingSlipEventSubscriber {
    onCompleted?(event: IRoutingSlipCompleted): Promise<void>;
    onFaulted?(event: IRoutingSlipFaulted): Promise<void>;
    onCompensationFailed?(event: IRoutingSlipCompensationFailed): Promise<void>;
    onActivityCompleted?(event: IRoutingSlipActivityCompleted): Promise<void>;
    onActivityFaulted?(event: IRoutingSlipActivityFaulted): Promise<void>;
    onActivityCompensated?(event: IRoutingSlipActivityCompensated): Promise<void>;
    onTerminated?(event: IRoutingSlipTerminated): Promise<void>;
}
