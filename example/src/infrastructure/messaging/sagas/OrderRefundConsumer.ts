import {Controller, Inject, Injectable, Logger} from "@nestjs/common";
import {OrderConfirmed, OrderFailed, ProcessPayment, RefundPayment} from "@shared/messages/message";
import { BusTransitConsumer, IPublishEndpoint, ISagaConsumeContext } from "nestjs-bustransit";

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