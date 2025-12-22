import {Controller, Inject, Injectable, Logger} from "@nestjs/common";
import { v7 as uuidv7 } from 'uuid';
import {OrderConfirmed, OrderFailed, ProcessPayment} from "@shared/messages/message";
import { BusTransitConsumer, IPublishEndpoint, ISagaConsumeContext } from "nestjs-bustransit";


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