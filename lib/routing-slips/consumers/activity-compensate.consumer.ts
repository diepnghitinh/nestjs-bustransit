/**
 * Generic consumer for routing slip activity compensate operations
 * Handles compensate messages sent to activity compensate queues
 */

import { Injectable, Logger } from '@nestjs/common';
import { BusTransitConsumer, IConsumeContext } from '../../index';
import { BehaviorContext } from '../../factories/behavior.context';
import { IActivity } from '../../interfaces/activity.interface';
import { RoutingSlipActivityCompensateMessage } from '../messages/routing-slip-activity-compensate.message';
import { RoutingSlipActivityCompensateResponseMessage } from '../messages/routing-slip-activity-compensate-response.message';
import { CompensateContext } from '../../factories/execute.context';

/**
 * Factory to create activity compensate consumers dynamically
 */
export class ActivityCompensateConsumerFactory {
    /**
     * Create a consumer class for an activity's compensate operation
     */
    static createConsumer<TArguments, TLog>(
        activityName: string,
        activity: IActivity<TArguments, TLog>
    ): typeof BusTransitConsumer {
        @Injectable()
        class DynamicActivityCompensateConsumer extends BusTransitConsumer<RoutingSlipActivityCompensateMessage<TLog>> {
            private readonly logger = new Logger(`${activityName}CompensateConsumer`);

            constructor() {
                super(RoutingSlipActivityCompensateMessage);
            }

            async Consume(
                ctx: BehaviorContext<any, RoutingSlipActivityCompensateMessage<TLog>>,
                context: IConsumeContext<RoutingSlipActivityCompensateMessage<TLog>>
            ): Promise<void> {
                await super.Consume(ctx, context);

                const message = context.Message;
                this.logger.log(`[Compensate] Received compensate request for activity: ${message.activityName}`);
                this.logger.log(`[Compensate] Tracking number: ${message.trackingNumber}`);

                let response: RoutingSlipActivityCompensateResponseMessage;

                try {
                    // Create compensation context
                    const compensateContext = new CompensateContext(
                        message.trackingNumber,
                        message.compensationLog,
                        new Map(Object.entries(message.variables || {}))
                    );

                    // Compensate the activity
                    await activity.compensate(compensateContext);

                    response = new RoutingSlipActivityCompensateResponseMessage({
                        trackingNumber: message.trackingNumber,
                        activityName: message.activityName,
                        success: true,
                        timestamp: new Date(),
                        correlationId: message.correlationId
                    });

                    this.logger.log(`[Compensate] Activity compensated successfully: ${message.activityName}`);

                } catch (error) {
                    this.logger.error(`[Compensate] Compensation failed: ${error.message}`, error.stack);

                    response = new RoutingSlipActivityCompensateResponseMessage({
                        trackingNumber: message.trackingNumber,
                        activityName: message.activityName,
                        success: false,
                        error: {
                            message: error.message,
                            stack: error.stack
                        },
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
        Object.defineProperty(DynamicActivityCompensateConsumer, 'name', {
            value: `${activityName}CompensateConsumer`,
            writable: false
        });

        return DynamicActivityCompensateConsumer as any;
    }
}
