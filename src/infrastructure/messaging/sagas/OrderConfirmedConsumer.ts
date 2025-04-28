import {Controller, Inject, Injectable, Logger} from "@nestjs/common";
import { v7 as uuidv7 } from 'uuid';
import {IPublishEndpoint} from "@core/bustransit/interfaces/publish-endpoint.interface";
import {BusTransitConsumer} from "@core/bustransit/factories/consumer";
import {OrderConfirmed, OrderFailed, ProcessPayment} from "@shared/messages/message";
import {ISagaConsumeContext} from "@core/bustransit/interfaces/saga.consumer.interface";


@Injectable()
export class OrderConfirmedConsumer extends BusTransitConsumer<OrderConfirmed> {

    constructor(
        @Inject(IPublishEndpoint)
        private readonly publishEndpoint: IPublishEndpoint,
    ) {
        super(OrderConfirmed);
    }

    async Consume(ctx, context: ISagaConsumeContext<any, OrderConfirmed>): Promise<any> {
        await super.Consume(ctx, context)
        return 'Order confirmed: ' + context.Message.OrderId
    }
}