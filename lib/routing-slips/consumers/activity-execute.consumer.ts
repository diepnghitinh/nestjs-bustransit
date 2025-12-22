/**
 * Generic consumer for routing slip activity execute operations
 * Handles execute messages sent to activity execute queues
 */

import { Injectable, Logger } from '@nestjs/common';
import { BusTransitConsumer, IConsumeContext } from '../../index';
import { BehaviorContext } from '../../factories/behavior.context';
import { IActivity, IExecuteActivity, ActivityResultType } from '../../interfaces/activity.interface';
import { RoutingSlipActivityExecuteMessage } from '../messages/routing-slip-activity-execute.message';
import { RoutingSlipActivityExecuteResponseMessage } from '../messages/routing-slip-activity-execute-response.message';
import { ExecuteContext } from '../../factories/execute.context';

/**
 * Factory to create activity execute consumers dynamically
 */
export class ActivityExecuteConsumerFactory {
    /**
     * Create a consumer class for an activity's execute operation
     */
    static createConsumer<TArguments, TLog>(
        activityName: string,
        activity: IActivity<TArguments, TLog> | IExecuteActivity<TArguments>
    ): typeof BusTransitConsumer {
        @Injectable()
        class DynamicActivityExecuteConsumer extends BusTransitConsumer<RoutingSlipActivityExecuteMessage<TArguments>> {
            private readonly logger = new Logger(`${activityName}ExecuteConsumer`);

            constructor() {
                super(RoutingSlipActivityExecuteMessage);
            }

            async Consume(
                ctx: BehaviorContext<any, RoutingSlipActivityExecuteMessage<TArguments>>,
                context: IConsumeContext<RoutingSlipActivityExecuteMessage<TArguments>>
            ): Promise<void> {
                await super.Consume(ctx, context);

                const message = context.Message;
                this.logger.log(`[Execute] Received execute request for activity: ${message.activityName}`);
                this.logger.log(`[Execute] Tracking number: ${message.trackingNumber}`);

                const startTime = Date.now();
                let response: RoutingSlipActivityExecuteResponseMessage;

                try {
                    // Create execution context
                    const executeContext = new ExecuteContext(
                        message.trackingNumber,
                        message.args,
                        new Map(Object.entries(message.variables || {}))
                    );

                    // Execute the activity
                    const result = await activity.execute(executeContext);

                    // Build response based on result
                    if (result.resultType === ActivityResultType.Complete) {
                        response = new RoutingSlipActivityExecuteResponseMessage({
                            trackingNumber: message.trackingNumber,
                            activityName: message.activityName,
                            executionId: message.executionId,
                            success: true,
                            resultType: 'Complete',
                            compensationLog: result.compensationLog,
                            variables: result.variables ? Object.fromEntries(result.variables) : undefined,
                            duration: Date.now() - startTime,
                            timestamp: new Date(),
                            correlationId: message.correlationId
                        });

                        this.logger.log(`[Execute] Activity completed successfully: ${message.activityName}`);
                    } else if (result.resultType === ActivityResultType.Fault) {
                        response = new RoutingSlipActivityExecuteResponseMessage({
                            trackingNumber: message.trackingNumber,
                            activityName: message.activityName,
                            executionId: message.executionId,
                            success: false,
                            resultType: 'Fault',
                            error: {
                                message: result.exception?.message || 'Unknown error',
                                stack: result.exception?.stack
                            },
                            duration: Date.now() - startTime,
                            timestamp: new Date(),
                            correlationId: message.correlationId
                        });

                        this.logger.error(`[Execute] Activity faulted: ${message.activityName} - ${result.exception?.message}`);
                    } else if (result.resultType === ActivityResultType.Terminate) {
                        response = new RoutingSlipActivityExecuteResponseMessage({
                            trackingNumber: message.trackingNumber,
                            activityName: message.activityName,
                            executionId: message.executionId,
                            success: true,
                            resultType: 'Terminate',
                            duration: Date.now() - startTime,
                            timestamp: new Date(),
                            correlationId: message.correlationId
                        });

                        this.logger.log(`[Execute] Activity terminated: ${message.activityName}`);
                    }

                } catch (error) {
                    this.logger.error(`[Execute] Unexpected error: ${error.message}`, error.stack);

                    response = new RoutingSlipActivityExecuteResponseMessage({
                        trackingNumber: message.trackingNumber,
                        activityName: message.activityName,
                        executionId: message.executionId,
                        success: false,
                        resultType: 'Fault',
                        error: {
                            message: error.message,
                            stack: error.stack
                        },
                        duration: Date.now() - startTime,
                        timestamp: new Date(),
                        correlationId: message.correlationId
                    });
                }

                // Send response (if using request/reply pattern)
                // Note: Response publishing is optional for now since we're using in-process fallback
                // In a full distributed implementation, this would publish to a response queue
                // if (message.correlationId && this.producer) {
                //     await this.producer.Publish(response);
                // }
            }
        }

        // Set a meaningful name for the consumer class
        Object.defineProperty(DynamicActivityExecuteConsumer, 'name', {
            value: `${activityName}ExecuteConsumer`,
            writable: false
        });

        return DynamicActivityExecuteConsumer as any;
    }
}
