/**
 * Activity Interfaces for Routing Slips
 * Based on MassTransit's Activity pattern
 */

import { IRoutingSlip } from './routing-slip.interface';

/**
 * Result type for activity execution
 */
export enum ActivityResultType {
    Complete = 'Complete',
    Fault = 'Fault',
    Terminate = 'Terminate'
}

/**
 * Result returned from activity execution
 */
export interface IActivityResult {
    resultType: ActivityResultType;
    compensationLog?: any;
    variables?: Map<string, any>;
    revisedItinerary?: any[];
    exception?: Error;
}

/**
 * Context provided to activity during execution
 */
export interface IExecuteContext<TArguments> {
    trackingNumber: string;
    args: TArguments;
    variables: Map<string, any>;

    /**
     * Complete the activity with optional compensation log
     */
    completed(compensationLog?: any): IActivityResult;

    /**
     * Complete the activity with revised itinerary
     */
    completedWithVariables(variables: Map<string, any>, compensationLog?: any): IActivityResult;

    /**
     * Revise the itinerary during execution
     */
    reviseItinerary(builder: (itinerary: any) => void): IActivityResult;

    /**
     * Fault the activity, triggering compensation
     */
    faulted(exception: Error): IActivityResult;

    /**
     * Terminate the routing slip gracefully
     */
    terminated(): IActivityResult;
}

/**
 * Context provided during compensation
 */
export interface ICompensateContext<TLog> {
    trackingNumber: string;
    compensationLog: TLog;
    variables: Map<string, any>;
}

/**
 * Activity that supports both execution and compensation
 */
export interface IActivity<TArguments, TLog = any> {
    /**
     * Activity name
     */
    name: string;

    /**
     * Execute the activity
     */
    execute(context: IExecuteContext<TArguments>): Promise<IActivityResult>;

    /**
     * Compensate the activity (undo the action)
     */
    compensate(context: ICompensateContext<TLog>): Promise<void>;
}

/**
 * Execute-only activity without compensation support
 */
export interface IExecuteActivity<TArguments> {
    /**
     * Activity name
     */
    name: string;

    /**
     * Execute the activity
     */
    execute(context: IExecuteContext<TArguments>): Promise<IActivityResult>;
}

/**
 * Activity factory for dependency injection
 */
export interface IActivityFactory {
    createActivity<TArguments, TLog>(activityName: string): IActivity<TArguments, TLog> | IExecuteActivity<TArguments>;
}
