import {Controller, Inject, Injectable, Logger} from "@nestjs/common";
import { v7 as uuidv7 } from 'uuid';
import {IPublishEndpoint} from "@core/bustransit/interfaces/publish-endpoint.interface";
import {BusTransitConsumer} from "@core/bustransit/factories/consumer";
import {OrderFailed, ProcessPayment, ReserveInventory} from "@shared/messages/message";
import {ISagaConsumeContext} from "@core/bustransit/interfaces/saga.consumer.interface";
import {InventoryReserved, PaymentProcessed} from "@infrastructure/messaging/sagas/OrderProcessingStateMachine";

@Injectable()
export class ReserveInventoryConsumer extends BusTransitConsumer<ReserveInventory> {

    constructor(
        @Inject(IPublishEndpoint)
        private readonly publishEndpoint: IPublishEndpoint,
    ) {
        super(ReserveInventory);
    }

    async Consume(ctx, context: ISagaConsumeContext<any, ReserveInventory>): Promise<any> {
        await super.Consume(ctx, context)

        const randomRate = Math.random();
        if (randomRate > 0.5) {
            let inventoryReserved = new InventoryReserved();
            inventoryReserved.OrderId = context.Message.OrderId;
            return await this.publishEndpoint.Send<InventoryReserved>(inventoryReserved, ctx);
        } else {
            let orderFailed = new OrderFailed();
            orderFailed.OrderId = context.Message.OrderId;
            orderFailed.Reason = "Inventory not available";
            return await this.publishEndpoint.Send<OrderFailed>(orderFailed, ctx);
        }
        return ''
    }
}