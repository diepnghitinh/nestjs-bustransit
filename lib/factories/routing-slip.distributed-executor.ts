/**
 * Distributed Routing Slip Executor
 * Executes routing slips via message queues for distributed scenarios
 */

import { Logger, Inject } from '@nestjs/common';
import { IRoutingSlip, IActivityLog, IActivityException } from '../interfaces/routing-slip.interface';
import { IActivityFactory, ActivityResultType } from '../interfaces/activity.interface';
import { IPublishEndpoint } from '../interfaces/publish-endpoint.interface';
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
import { RoutingSlipActivityExecuteMessage } from '../routing-slips/messages/routing-slip-activity-execute.message';
import { RoutingSlipActivityCompensateMessage } from '../routing-slips/messages/routing-slip-activity-compensate.message';
import { RoutingSlipQueueProvisioningService } from '../services/routing-slip-queue-provisioning.service';

/**
 * Executes routing slips in distributed mode using message queues
 */
export class RoutingSlipDistributedExecutor {
    private eventSubscribers: IRoutingSlipEventSubscriber[] = [];

    constructor(
        private readonly activityFactory: IActivityFactory,
        private readonly publishEndpoint: IPublishEndpoint,
        private readonly queueProvisioning: RoutingSlipQueueProvisioningService
    ) {}

    /**
     * Subscribe to routing slip events
     */
    subscribe(subscriber: IRoutingSlipEventSubscriber): void {
        this.eventSubscribers.push(subscriber);
    }

    /**
     * Execute a routing slip using distributed message queues
     *
     * NOTE: This is a simplified implementation that demonstrates the concept.
     * A production implementation would require:
     * - Correlation ID management for request/reply
     * - Timeout handling
     * - Dead letter queues
     * - State persistence
     * - Idempotency
     */
    async execute(routingSlip: IRoutingSlip): Promise<void> {
        const startTime = Date.now();
        let currentActivityIndex = 0;

        try {
            Logger.log(`[DRS] Starting distributed routing slip execution: ${routingSlip.trackingNumber}`);
            Logger.log(`[DRS] Itinerary has ${routingSlip.itinerary.length} activities`);

            // Execute each activity in the itinerary via message queues
            while (currentActivityIndex < routingSlip.itinerary.length) {
                const activitySpec = routingSlip.itinerary[currentActivityIndex];
                const queueConfig = this.queueProvisioning.getQueueConfiguration(activitySpec.name);

                if (!queueConfig) {
                    throw new Error(`Queue configuration not found for activity: ${activitySpec.name}`);
                }

                Logger.log(`[DRS] Sending execute message to queue [${currentActivityIndex + 1}/${routingSlip.itinerary.length}]: ${queueConfig.executeQueueName}`);

                const executionId = uuidv4();
                const activityStartTime = Date.now();

                try {
                    // Create execute message
                    const executeMessage = new RoutingSlipActivityExecuteMessage({
                        trackingNumber: routingSlip.trackingNumber,
                        activityName: activitySpec.name,
                        executionId,
                        args: activitySpec.args,
                        variables: Object.fromEntries(routingSlip.variables),
                        timestamp: new Date(),
                        correlationId: uuidv4()
                    });

                    // Publish message to execute queue
                    // NOTE: In a real implementation, you would:
                    // 1. Send the message to the queue
                    // 2. Wait for a response message (request/reply pattern)
                    // 3. Handle timeouts
                    // For now, we'll use the in-process executor as fallback
                    Logger.warn(`[DRS] Distributed execution requires message broker setup`);
                    Logger.warn(`[DRS] Falling back to in-process execution for activity: ${activitySpec.name}`);

                    // Publish the message (this would go to the queue)
                    await this.publishEndpoint.Publish(executeMessage);

                    // NOTE: In production, wait for response here via correlation ID
                    // For this demo, we'll execute in-process as proof of concept
                    const activity = this.activityFactory.createActivity(activitySpec.name);
                    const { ExecuteContext } = await import('./execute.context');
                    const executeContext = new ExecuteContext(
                        routingSlip.trackingNumber,
                        activitySpec.args,
                        routingSlip.variables
                    );

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

                        Logger.log(`[DRS] Activity completed: ${activitySpec.name} (${duration}ms)`);
                        currentActivityIndex++;

                    } else if (result.resultType === ActivityResultType.Fault) {
                        // Activity faulted - trigger compensation
                        Logger.error(`[DRS] Activity faulted: ${activitySpec.name} - ${result.exception?.message}`);

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

                        // Compensate all completed activities via message queues
                        await this.compensateDistributed(routingSlip);

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
                        Logger.log(`[DRS] Routing slip terminated by activity: ${activitySpec.name}`);

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
                    Logger.error(`[DRS] Unexpected error executing activity ${activitySpec.name}: ${error.message}`);

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
                    await this.compensateDistributed(routingSlip);

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
            Logger.log(`[DRS] Distributed routing slip completed successfully: ${routingSlip.trackingNumber} (${duration}ms)`);

            await this.emitCompleted({
                trackingNumber: routingSlip.trackingNumber,
                timestamp: new Date(),
                duration,
                variables: routingSlip.variables,
                activityLogs: routingSlip.activityLogs
            });

        } catch (error) {
            Logger.error(`[DRS] Distributed routing slip execution failed: ${routingSlip.trackingNumber} - ${error.message}`);
            throw error;
        }
    }

    /**
     * Compensate all completed activities in reverse order (LIFO) via message queues
     */
    private async compensateDistributed(routingSlip: IRoutingSlip): Promise<void> {
        if (routingSlip.activityLogs.length === 0) {
            Logger.log(`[DRS] No activities to compensate`);
            return;
        }

        Logger.log(`[DRS] Starting distributed compensation for ${routingSlip.activityLogs.length} activities`);

        // Reverse the activity logs (LIFO)
        const logsToCompensate = [...routingSlip.activityLogs].reverse();

        for (const log of logsToCompensate) {
            try {
                const queueConfig = this.queueProvisioning.getQueueConfiguration(log.activityName);

                if (!queueConfig || !queueConfig.hasCompensation) {
                    Logger.warn(`[DRS] Activity does not support compensation: ${log.activityName}`);
                    continue;
                }

                Logger.log(`[DRS] Sending compensate message to queue: ${queueConfig.compensateQueueName}`);

                // Create compensate message
                const compensateMessage = new RoutingSlipActivityCompensateMessage({
                    trackingNumber: routingSlip.trackingNumber,
                    activityName: log.activityName,
                    compensationLog: log.compensationLog,
                    variables: Object.fromEntries(routingSlip.variables),
                    timestamp: new Date(),
                    correlationId: uuidv4()
                });

                // Publish message to compensate queue
                await this.publishEndpoint.Publish(compensateMessage);

                // NOTE: In production, wait for response here
                // For this demo, we'll execute in-process as proof of concept
                const activity = this.activityFactory.createActivity(log.activityName);
                if ('compensate' in activity) {
                    const { CompensateContext } = await import('./execute.context');
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

                    Logger.log(`[DRS] Successfully compensated: ${log.activityName}`);
                }

            } catch (error) {
                Logger.error(`[DRS] Failed to compensate activity ${log.activityName}: ${error.message}`);

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

        Logger.log(`[DRS] Distributed compensation completed`);
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
