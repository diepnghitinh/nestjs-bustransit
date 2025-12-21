/**
 * Routing Slip Executor
 * Executes routing slips with automatic compensation on failure
 */

import { Logger } from '@nestjs/common';
import { IRoutingSlip, IActivityLog, IActivityException } from '../interfaces/routing-slip.interface';
import { IActivity, IExecuteActivity, IActivityFactory, ActivityResultType } from '../interfaces/activity.interface';
import { ExecuteContext, CompensateContext } from './execute.context';
import {
    IRoutingSlipEventSubscriber,
    IRoutingSlipCompleted,
    IRoutingSlipFaulted,
    IRoutingSlipActivityCompleted,
    IRoutingSlipActivityFaulted,
    IRoutingSlipActivityCompensated,
    IRoutingSlipCompensationFailed,
    IRoutingSlipTerminated
} from '../interfaces/routing-slip.events';
import { v4 as uuidv4 } from 'uuid';

/**
 * Executes routing slips with activity coordination and automatic compensation
 */
export class RoutingSlipExecutor {
    private eventSubscribers: IRoutingSlipEventSubscriber[] = [];

    constructor(
        private readonly activityFactory: IActivityFactory
    ) {}

    /**
     * Subscribe to routing slip events
     */
    subscribe(subscriber: IRoutingSlipEventSubscriber): void {
        this.eventSubscribers.push(subscriber);
    }

    /**
     * Execute a routing slip
     */
    async execute(routingSlip: IRoutingSlip): Promise<void> {
        const startTime = Date.now();
        let currentActivityIndex = 0;

        try {
            Logger.log(`[RS] Starting routing slip execution: ${routingSlip.trackingNumber}`);
            Logger.log(`[RS] Itinerary has ${routingSlip.itinerary.length} activities`);

            // Execute each activity in the itinerary
            while (currentActivityIndex < routingSlip.itinerary.length) {
                const activitySpec = routingSlip.itinerary[currentActivityIndex];
                const activity = this.activityFactory.createActivity(activitySpec.name);

                if (!activity) {
                    throw new Error(`Activity not found: ${activitySpec.name}`);
                }

                Logger.log(`[RS] Executing activity [${currentActivityIndex + 1}/${routingSlip.itinerary.length}]: ${activitySpec.name}`);

                const activityStartTime = Date.now();
                const executionId = uuidv4();

                try {
                    // Create execution context
                    const executeContext = new ExecuteContext(
                        routingSlip.trackingNumber,
                        activitySpec.args,
                        routingSlip.variables
                    );

                    // Execute the activity
                    const result = await activity.execute(executeContext);

                    // Handle result
                    if (result.resultType === ActivityResultType.Complete) {
                        const duration = Date.now() - activityStartTime;

                        // Log the activity execution
                        const activityLog: IActivityLog = {
                            activityName: activitySpec.name,
                            timestamp: new Date(),
                            duration,
                            compensationLog: result.compensationLog
                        };
                        routingSlip.activityLogs.push(activityLog);

                        // Merge variables
                        if (result.variables) {
                            routingSlip.variables = new Map([...routingSlip.variables, ...result.variables]);
                        }

                        // Emit activity completed event
                        await this.emitActivityCompleted({
                            trackingNumber: routingSlip.trackingNumber,
                            timestamp: new Date(),
                            duration,
                            variables: routingSlip.variables,
                            activityName: activitySpec.name,
                            executionId,
                            args: activitySpec.args,
                            data: result.compensationLog
                        });

                        Logger.log(`[RS] Activity completed: ${activitySpec.name} (${duration}ms)`);
                        currentActivityIndex++;

                    } else if (result.resultType === ActivityResultType.Fault) {
                        // Activity faulted - trigger compensation
                        Logger.error(`[RS] Activity faulted: ${activitySpec.name} - ${result.exception?.message}`);

                        const exception: IActivityException = {
                            activityName: activitySpec.name,
                            timestamp: new Date(),
                            exceptionInfo: {
                                message: result.exception?.message || 'Unknown error',
                                stackTrace: result.exception?.stack
                            }
                        };
                        routingSlip.activityExceptions.push(exception);

                        // Emit activity faulted event
                        await this.emitActivityFaulted({
                            trackingNumber: routingSlip.trackingNumber,
                            timestamp: new Date(),
                            variables: routingSlip.variables,
                            activityName: activitySpec.name,
                            executionId,
                            exception
                        });

                        // Compensate all completed activities
                        await this.compensate(routingSlip);

                        // Emit routing slip faulted event
                        await this.emitFaulted({
                            trackingNumber: routingSlip.trackingNumber,
                            timestamp: new Date(),
                            duration: Date.now() - startTime,
                            variables: routingSlip.variables,
                            activityLogs: routingSlip.activityLogs,
                            activityExceptions: routingSlip.activityExceptions
                        });

                        return;

                    } else if (result.resultType === ActivityResultType.Terminate) {
                        // Graceful termination
                        Logger.log(`[RS] Routing slip terminated by activity: ${activitySpec.name}`);

                        await this.emitTerminated({
                            trackingNumber: routingSlip.trackingNumber,
                            timestamp: new Date(),
                            duration: Date.now() - startTime,
                            variables: routingSlip.variables,
                            activityLogs: routingSlip.activityLogs,
                            reason: `Terminated by ${activitySpec.name}`
                        });

                        return;
                    }

                } catch (error) {
                    Logger.error(`[RS] Unexpected error executing activity ${activitySpec.name}: ${error.message}`);

                    const exception: IActivityException = {
                        activityName: activitySpec.name,
                        timestamp: new Date(),
                        exceptionInfo: {
                            message: error.message,
                            stackTrace: error.stack
                        }
                    };
                    routingSlip.activityExceptions.push(exception);

                    // Compensate all completed activities
                    await this.compensate(routingSlip);

                    // Emit routing slip faulted event
                    await this.emitFaulted({
                        trackingNumber: routingSlip.trackingNumber,
                        timestamp: new Date(),
                        duration: Date.now() - startTime,
                        variables: routingSlip.variables,
                        activityLogs: routingSlip.activityLogs,
                        activityExceptions: routingSlip.activityExceptions
                    });

                    throw error;
                }
            }

            // All activities completed successfully
            const duration = Date.now() - startTime;
            Logger.log(`[RS] Routing slip completed successfully: ${routingSlip.trackingNumber} (${duration}ms)`);

            await this.emitCompleted({
                trackingNumber: routingSlip.trackingNumber,
                timestamp: new Date(),
                duration,
                variables: routingSlip.variables,
                activityLogs: routingSlip.activityLogs
            });

        } catch (error) {
            Logger.error(`[RS] Routing slip execution failed: ${routingSlip.trackingNumber} - ${error.message}`);
            throw error;
        }
    }

    /**
     * Compensate all completed activities in reverse order (LIFO)
     */
    private async compensate(routingSlip: IRoutingSlip): Promise<void> {
        if (routingSlip.activityLogs.length === 0) {
            Logger.log(`[RS] No activities to compensate`);
            return;
        }

        Logger.log(`[RS] Starting compensation for ${routingSlip.activityLogs.length} activities`);

        // Reverse the activity logs (LIFO)
        const logsToCompensate = [...routingSlip.activityLogs].reverse();

        for (const log of logsToCompensate) {
            try {
                const activity = this.activityFactory.createActivity(log.activityName);

                // Check if activity supports compensation
                if (this.isCompensatableActivity(activity)) {
                    Logger.log(`[RS] Compensating activity: ${log.activityName}`);

                    const compensateContext = new CompensateContext(
                        routingSlip.trackingNumber,
                        log.compensationLog,
                        routingSlip.variables
                    );

                    await activity.compensate(compensateContext);

                    routingSlip.compensateLogs.push({
                        activityName: log.activityName,
                        timestamp: new Date()
                    });

                    // Emit activity compensated event
                    await this.emitActivityCompensated({
                        trackingNumber: routingSlip.trackingNumber,
                        timestamp: new Date(),
                        variables: routingSlip.variables,
                        activityName: log.activityName,
                        compensationLog: log.compensationLog
                    });

                    Logger.log(`[RS] Successfully compensated: ${log.activityName}`);
                } else {
                    Logger.warn(`[RS] Activity does not support compensation: ${log.activityName}`);
                }

            } catch (error) {
                Logger.error(`[RS] Failed to compensate activity ${log.activityName}: ${error.message}`);

                // Emit compensation failed event
                await this.emitCompensationFailed({
                    trackingNumber: routingSlip.trackingNumber,
                    timestamp: new Date(),
                    variables: routingSlip.variables,
                    activityLogs: routingSlip.activityLogs,
                    compensateLogs: routingSlip.compensateLogs,
                    activityExceptions: routingSlip.activityExceptions
                });

                // Continue compensating other activities despite the failure
            }
        }

        Logger.log(`[RS] Compensation completed`);
    }

    /**
     * Type guard to check if activity supports compensation
     */
    private isCompensatableActivity<TArguments, TLog>(
        activity: IActivity<TArguments, TLog> | IExecuteActivity<TArguments>
    ): activity is IActivity<TArguments, TLog> {
        return 'compensate' in activity && typeof activity.compensate === 'function';
    }

    // Event emission methods
    private async emitCompleted(event: IRoutingSlipCompleted): Promise<void> {
        for (const subscriber of this.eventSubscribers) {
            if (subscriber.onCompleted) {
                await subscriber.onCompleted(event);
            }
        }
    }

    private async emitFaulted(event: IRoutingSlipFaulted): Promise<void> {
        for (const subscriber of this.eventSubscribers) {
            if (subscriber.onFaulted) {
                await subscriber.onFaulted(event);
            }
        }
    }

    private async emitActivityCompleted(event: IRoutingSlipActivityCompleted): Promise<void> {
        for (const subscriber of this.eventSubscribers) {
            if (subscriber.onActivityCompleted) {
                await subscriber.onActivityCompleted(event);
            }
        }
    }

    private async emitActivityFaulted(event: IRoutingSlipActivityFaulted): Promise<void> {
        for (const subscriber of this.eventSubscribers) {
            if (subscriber.onActivityFaulted) {
                await subscriber.onActivityFaulted(event);
            }
        }
    }

    private async emitActivityCompensated(event: IRoutingSlipActivityCompensated): Promise<void> {
        for (const subscriber of this.eventSubscribers) {
            if (subscriber.onActivityCompensated) {
                await subscriber.onActivityCompensated(event);
            }
        }
    }

    private async emitCompensationFailed(event: IRoutingSlipCompensationFailed): Promise<void> {
        for (const subscriber of this.eventSubscribers) {
            if (subscriber.onCompensationFailed) {
                await subscriber.onCompensationFailed(event);
            }
        }
    }

    private async emitTerminated(event: IRoutingSlipTerminated): Promise<void> {
        for (const subscriber of this.eventSubscribers) {
            if (subscriber.onTerminated) {
                await subscriber.onTerminated(event);
            }
        }
    }
}
