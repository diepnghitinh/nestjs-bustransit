/**
 * Execute Fulfillment Consumer
 *
 * This consumer demonstrates the hybrid pattern:
 * - Receives a saga command (ExecuteFulfillment)
 * - Executes a routing slip with multiple activities
 * - Reports back to the saga based on routing slip result
 *
 * This is the key integration point between Saga and Routing Slip patterns.
 */

import { Inject, Injectable, Logger } from "@nestjs/common";
import { BusTransitConsumer, IPublishEndpoint, ISagaConsumeContext, RoutingSlipService } from "nestjs-bustransit";
import { ExecuteFulfillment, FulfillmentCompleted, FulfillmentFailed } from "./OrderFulfillmentSaga";

@Injectable()
export class ExecuteFulfillmentConsumer extends BusTransitConsumer<ExecuteFulfillment> {

    constructor(
        @Inject(IPublishEndpoint)
        private readonly publishEndpoint: IPublishEndpoint,
        private readonly routingSlipService: RoutingSlipService,
    ) {
        super(ExecuteFulfillment);
    }

    async Consume(ctx, context: ISagaConsumeContext<any, ExecuteFulfillment>): Promise<any> {
        await super.Consume(ctx, context);

        Logger.log(`[ExecuteFulfillmentConsumer] Received fulfillment command for order ${context.Message.OrderId}`);
        Logger.log(`[ExecuteFulfillmentConsumer] Using routing slip to execute multi-step fulfillment process`);

        try {
            // Build a routing slip for the fulfillment process
            // This routing slip coordinates: Pick → Pack → Label → Quality Check
            const routingSlip = this.routingSlipService.createBuilder(`fulfillment-${context.Message.OrderId}`)
                .addActivity('PickItems', 'warehouse-service', {
                    orderId: context.Message.OrderId,
                    items: context.Message.Items
                })
                .addActivity('PackItems', 'warehouse-service', {
                    orderId: context.Message.OrderId
                })
                .addActivity('GenerateShippingLabel', 'shipping-service', {
                    orderId: context.Message.OrderId
                })
                .addActivity('QualityCheck', 'quality-service', {
                    orderId: context.Message.OrderId,
                    shouldFail: false // Set to true to test compensation
                })
                .addVariable('orderId', context.Message.OrderId)
                .build();

            Logger.log(`[ExecuteFulfillmentConsumer] Routing slip created: ${routingSlip.trackingNumber}`);
            Logger.log(`[ExecuteFulfillmentConsumer] Executing fulfillment activities...`);

            // Execute the routing slip
            // If any activity fails, the routing slip will automatically compensate
            // all previously completed activities in reverse order
            await this.routingSlipService.execute(routingSlip);

            // Extract results from routing slip variables
            const fulfillmentId = routingSlip.variables.get('packageId');
            const warehouseId = routingSlip.variables.get('warehouseId');

            Logger.log(`[ExecuteFulfillmentConsumer] ✅ Routing slip completed successfully`);
            Logger.log(`[ExecuteFulfillmentConsumer] Fulfillment ID: ${fulfillmentId}`);
            Logger.log(`[ExecuteFulfillmentConsumer] Warehouse: ${warehouseId}`);

            // Publish success event back to saga
            const successEvent = new FulfillmentCompleted();
            successEvent.OrderId = context.Message.OrderId;
            successEvent.FulfillmentId = fulfillmentId;
            successEvent.WarehouseId = warehouseId;

            Logger.log(`[ExecuteFulfillmentConsumer] Publishing FulfillmentCompleted event to saga`);
            await this.publishEndpoint.Send<FulfillmentCompleted>(successEvent, ctx);

        } catch (error) {
            Logger.error(`[ExecuteFulfillmentConsumer] ❌ Routing slip execution failed: ${error.message}`);
            Logger.log(`[ExecuteFulfillmentConsumer] Routing slip has automatically compensated all completed activities`);

            // Publish failure event back to saga
            const failureEvent = new FulfillmentFailed();
            failureEvent.OrderId = context.Message.OrderId;
            failureEvent.Reason = error.message;

            Logger.log(`[ExecuteFulfillmentConsumer] Publishing FulfillmentFailed event to saga`);
            await this.publishEndpoint.Send<FulfillmentFailed>(failureEvent, ctx);
        }
    }
}
