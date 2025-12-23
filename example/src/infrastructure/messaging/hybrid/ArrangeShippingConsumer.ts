/**
 * Arrange Shipping Consumer
 *
 * Handles shipping arrangement after fulfillment is complete.
 * This is a simpler consumer that doesn't use routing slips.
 */

import { Inject, Injectable, Logger } from "@nestjs/common";
import { BusTransitConsumer, IPublishEndpoint, ISagaConsumeContext } from "nestjs-bustransit";
import { ArrangeShipping, ShippingArranged, ShippingFailed } from "./OrderFulfillmentSaga";

@Injectable()
export class ArrangeShippingConsumer extends BusTransitConsumer<ArrangeShipping> {

    constructor(
        @Inject(IPublishEndpoint)
        private readonly publishEndpoint: IPublishEndpoint,
    ) {
        super(ArrangeShipping);
    }

    async Consume(ctx, context: ISagaConsumeContext<any, ArrangeShipping>): Promise<any> {
        await super.Consume(ctx, context);

        Logger.log(`[ArrangeShippingConsumer] Arranging shipping for order ${context.Message.OrderId}`);
        Logger.log(`[ArrangeShippingConsumer] Fulfillment: ${context.Message.FulfillmentId}`);
        Logger.log(`[ArrangeShippingConsumer] Warehouse: ${context.Message.WarehouseId}`);

        try {
            // Simulate arranging carrier pickup
            // In a real system, this would integrate with carrier APIs
            await new Promise(resolve => setTimeout(resolve, 200));

            // Random success/failure for demonstration
            const randomRate = Math.random();
            if (randomRate > 0.8) {
                throw new Error('Carrier pickup scheduling failed');
            }

            const trackingNumber = `SHIP-${Date.now()}-${context.Message.OrderId}`;

            Logger.log(`[ArrangeShippingConsumer] ✅ Shipping arranged successfully`);
            Logger.log(`[ArrangeShippingConsumer] Tracking: ${trackingNumber}`);

            // Publish success event
            const successEvent = new ShippingArranged();
            successEvent.OrderId = context.Message.OrderId;
            successEvent.TrackingNumber = trackingNumber;

            await this.publishEndpoint.Send<ShippingArranged>(successEvent, ctx);

        } catch (error) {
            Logger.error(`[ArrangeShippingConsumer] ❌ Failed to arrange shipping: ${error.message}`);

            // Publish failure event
            const failureEvent = new ShippingFailed();
            failureEvent.OrderId = context.Message.OrderId;
            failureEvent.Reason = error.message;

            await this.publishEndpoint.Send<ShippingFailed>(failureEvent, ctx);
        }
    }
}
