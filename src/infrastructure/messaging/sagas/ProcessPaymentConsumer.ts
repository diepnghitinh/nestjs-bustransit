import {Controller, Inject, Injectable, Logger} from "@nestjs/common";
import { v7 as uuidv7 } from 'uuid';
import {IPublishEndpoint} from "@core/bustransit/interfaces/publish-endpoint.interface";
import {BusTransitConsumer} from "@core/bustransit/factories/consumer";
import {OrderFailed, ProcessPayment} from "@shared/messages/message";
import {IsNotEmpty} from "@nestjs/class-validator";
import {ISagaConsumeContext} from "@core/bustransit/interfaces/saga.consumer.interface";
import {PaymentProcessed} from "@infrastructure/messaging/sagas/OrderProcessingStateMachine";


@Injectable()
export class ProcessPaymentConsumer extends BusTransitConsumer<ProcessPayment> {

    constructor(
        @Inject(IPublishEndpoint)
        private readonly publishEndpoint: IPublishEndpoint,
    ) {
        super(ProcessPayment);
    }

    async Consume(ctx, context: ISagaConsumeContext<any, ProcessPayment>): Promise<any> {
        await super.Consume(ctx, context)

        const randomRate = Math.random();
        if (randomRate > 0.2) {
            let paymentProcessed = new PaymentProcessed();
            paymentProcessed.OrderId = context.Message.OrderId;
            paymentProcessed.PaymentIntentId = `T_${uuidv7()}`;
            return await this.publishEndpoint.Send<PaymentProcessed>(paymentProcessed, ctx);
        } else {
            let orderFailed = new OrderFailed();
            orderFailed.OrderId = context.Message.OrderId;
            orderFailed.Reason = "Payment failed";
            return await this.publishEndpoint.Send<OrderFailed>(orderFailed, ctx);
        }
    }
}