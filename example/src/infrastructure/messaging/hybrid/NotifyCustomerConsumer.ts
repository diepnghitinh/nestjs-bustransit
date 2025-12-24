/**
 * Notify Customer Consumer
 *
 * Sends shipping notification to customer.
 * This is a simple fire-and-forget consumer.
 */

import { Injectable, Logger } from "@nestjs/common";
import { BusTransitConsumer, ISagaConsumeContext } from "nestjs-bustransit";
import { NotifyCustomer } from "./OrderFulfillmentSaga";

@Injectable()
export class NotifyCustomerConsumer extends BusTransitConsumer<NotifyCustomer> {

    constructor() {
        super(NotifyCustomer);
    }

    async Consume(ctx, context: ISagaConsumeContext<any, NotifyCustomer>): Promise<any> {
        await super.Consume(ctx, context);

        Logger.log(`[NotifyCustomerConsumer] Sending shipping notification`);
        Logger.log(`[NotifyCustomerConsumer] Order: ${context.Message.OrderId}`);
        Logger.log(`[NotifyCustomerConsumer] Email: ${context.Message.CustomerEmail}`);
        Logger.log(`[NotifyCustomerConsumer] Tracking: ${context.Message.TrackingNumber}`);

        // Simulate sending email
        await new Promise(resolve => setTimeout(resolve, 100));

        Logger.log(`[NotifyCustomerConsumer] ✅ Shipping notification sent successfully`);
        Logger.log(`[NotifyCustomerConsumer] Customer can track their order using: ${context.Message.TrackingNumber}`);
    }
}
