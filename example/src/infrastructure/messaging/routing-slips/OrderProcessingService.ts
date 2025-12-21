/**
 * Order Processing Service using Routing Slips
 * Example service that coordinates order processing using the routing slip pattern
 */

import { Injectable, Logger } from '@nestjs/common';
import { OrderActivityFactory } from './OrderActivityFactory';
import { IRoutingSlipEventSubscriber, RoutingSlipBuilder, RoutingSlipExecutor } from 'nestjs-bustransit';

/**
 * Service to process orders using routing slips
 */
@Injectable()
export class OrderProcessingService {
    private executor: RoutingSlipExecutor;

    constructor(private readonly activityFactory: OrderActivityFactory) {
        this.executor = new RoutingSlipExecutor(this.activityFactory);

        // Subscribe to routing slip events
        this.executor.subscribe(this.createEventSubscriber());
    }

    /**
     * Process an order using routing slip pattern
     */
    async processOrder(orderId: string, amount: number, customerId: string, customerEmail: string, items: any[]): Promise<void> {
        Logger.log(`[OrderProcessing] Starting order processing: ${orderId}`);

        try {
            // Build the routing slip
            const routingSlip = RoutingSlipBuilder.create(orderId)
                .addActivity('ProcessPayment', 'payment-service', {
                    orderId,
                    amount,
                    customerId
                })
                .addActivity('ReserveInventory', 'inventory-service', {
                    orderId,
                    items
                })
                .addActivity('SendConfirmation', 'notification-service', {
                    orderId,
                    customerEmail
                })
                .addVariable('orderId', orderId)
                .addVariable('customerEmail', customerEmail)
                .build();

            Logger.log(`[OrderProcessing] Routing slip created: ${routingSlip.trackingNumber}`);

            // Execute the routing slip
            await this.executor.execute(routingSlip);

            Logger.log(`[OrderProcessing] Order processed successfully: ${orderId}`);

        } catch (error) {
            Logger.error(`[OrderProcessing] Order processing failed: ${orderId} - ${error.message}`);
            throw error;
        }
    }

    /**
     * Create event subscriber for monitoring
     */
    private createEventSubscriber(): IRoutingSlipEventSubscriber {
        return {
            async onCompleted(event) {
                Logger.log(`[EVENT] Routing slip completed: ${event.trackingNumber} (${event.duration}ms)`);
                Logger.log(`[EVENT] Activities executed: ${event.activityLogs.length}`);
            },

            async onFaulted(event) {
                Logger.error(`[EVENT] Routing slip faulted: ${event.trackingNumber}`);
                Logger.error(`[EVENT] Exceptions: ${event.activityExceptions.map(e => e.exceptionInfo.message).join(', ')}`);
            },

            async onActivityCompleted(event) {
                Logger.log(`[EVENT] Activity completed: ${event.activityName} (${event.duration}ms)`);
            },

            async onActivityFaulted(event) {
                Logger.error(`[EVENT] Activity faulted: ${event.activityName} - ${event.exception.exceptionInfo.message}`);
            },

            async onActivityCompensated(event) {
                Logger.log(`[EVENT] Activity compensated: ${event.activityName}`);
            },

            async onCompensationFailed(event) {
                Logger.error(`[EVENT] Compensation failed for routing slip: ${event.trackingNumber}`);
            },

            async onTerminated(event) {
                Logger.log(`[EVENT] Routing slip terminated: ${event.trackingNumber} - ${event.reason}`);
            }
        };
    }
}
