/**
 * Execute Context Implementation
 * Context provided to activities during execution
 */

import { IExecuteContext, IActivityResult, ActivityResultType } from '../interfaces/activity.interface';

/**
 * Implementation of execution context for activities
 */
export class ExecuteContext<TArguments> implements IExecuteContext<TArguments> {
    constructor(
        public readonly trackingNumber: string,
        public readonly args: TArguments,
        public readonly variables: Map<string, any>
    ) {}

    completed(compensationLog?: any): IActivityResult {
        return {
            resultType: ActivityResultType.Complete,
            compensationLog,
            variables: new Map(this.variables)
        };
    }

    completedWithVariables(variables: Map<string, any>, compensationLog?: any): IActivityResult {
        const mergedVariables = new Map([...this.variables, ...variables]);
        return {
            resultType: ActivityResultType.Complete,
            compensationLog,
            variables: mergedVariables
        };
    }

    reviseItinerary(builder: (itinerary: any) => void): IActivityResult {
        // This will be handled by the executor
        return {
            resultType: ActivityResultType.Complete,
            variables: new Map(this.variables),
            revisedItinerary: [] // Will be populated by executor
        };
    }

    faulted(exception: Error): IActivityResult {
        return {
            resultType: ActivityResultType.Fault,
            exception,
            variables: new Map(this.variables)
        };
    }

    terminated(): IActivityResult {
        return {
            resultType: ActivityResultType.Terminate,
            variables: new Map(this.variables)
        };
    }
}

/**
 * Compensate Context Implementation
 */
export class CompensateContext<TLog> {
    constructor(
        public readonly trackingNumber: string,
        public readonly compensationLog: TLog,
        public readonly variables: Map<string, any>
    ) {}
}
