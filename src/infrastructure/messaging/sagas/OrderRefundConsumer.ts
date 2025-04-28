import {Controller, Inject, Injectable, Logger} from "@nestjs/common";
import { v7 as uuidv7 } from 'uuid';
import {IPublishEndpoint} from "@core/bustransit/interfaces/publish-endpoint.interface";
import {BusTransitConsumer} from "@core/bustransit/factories/consumer";
import {OrderConfirmed, OrderFailed, ProcessPayment, RefundPayment} from "@shared/messages/message";
import {IsNotEmpty} from "@nestjs/class-validator";
import {ISagaConsumeContext} from "@core/bustransit/interfaces/saga.consumer.interface";


@Injectable()
export class OrderRefundConsumer extends BusTransitConsumer<RefundPayment> {

    constructor(
        @Inject(IPublishEndpoint)
        private readonly publishEndpoint: IPublishEndpoint,
    ) {
        super(RefundPayment);
    }

    async Consume(ctx, context: ISagaConsumeContext<any, RefundPayment>): Promise<any> {
        await super.Consume(ctx, context)
        // Rollback Service
        return 'Order refund: ' + context.Message.OrderId
    }
}