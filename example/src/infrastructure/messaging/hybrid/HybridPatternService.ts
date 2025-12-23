/**
 * Hybrid Pattern Service
 *
 * Demonstrates combining Saga pattern with Routing Slips.
 * This service initiates the saga workflow.
 */

import { Inject, Injectable, Logger } from '@nestjs/common';
import { IPublishEndpoint } from 'nestjs-bustransit';
import { OrderSubmittedForFulfillment } from './OrderFulfillmentSaga';

@Injectable()
export class HybridPatternService {
    constructor(
        @Inject(IPublishEndpoint)
        private readonly publishEndpoint: IPublishEndpoint,
    ) {}

    /**
     * Submit an order for fulfillment using the hybrid saga/routing-slip pattern
     */
    async submitOrder(
        orderId: string,
        customerId: string,
        customerEmail: string,
        totalAmount: number,
        items: Array<{ sku: string; quantity: number }>
    ): Promise<void> {
        Logger.log(`\n${'='.repeat(80)}`);
        Logger.log(`[HybridPattern] STARTING HYBRID SAGA + ROUTING SLIP DEMONSTRATION`);
        Logger.log(`${'='.repeat(80)}\n`);

        Logger.log(`[HybridPattern] Submitting order for fulfillment:`);
        Logger.log(`  - Order ID: ${orderId}`);
        Logger.log(`  - Customer: ${customerId}`);
        Logger.log(`  - Email: ${customerEmail}`);
        Logger.log(`  - Total: $${totalAmount}`);
        Logger.log(`  - Items: ${items.length} types`);

        Logger.log(`\n[HybridPattern] PATTERN OVERVIEW:`);
        Logger.log(`  1. SAGA: Manages high-level order fulfillment workflow`);
        Logger.log(`     States: Submitted → Fulfilling → Shipping → Completed`);
        Logger.log(`  2. ROUTING SLIP: Handles complex multi-step fulfillment process`);
        Logger.log(`     Activities: Pick → Pack → Label → QualityCheck`);
        Logger.log(`     Each activity supports compensation (undo)`);
        Logger.log(`\n`);

        const event = new OrderSubmittedForFulfillment();
        event.OrderId = orderId;
        event.CustomerId = customerId;
        event.CustomerEmail = customerEmail;
        event.TotalAmount = totalAmount;
        event.Items = items;

        await this.publishEndpoint.Send(event, null);

        Logger.log(`[HybridPattern] Order submitted - saga workflow initiated\n`);
    }
}
