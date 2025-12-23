import {Controller, Inject, Injectable, Logger} from "@nestjs/common";
import { v7 as uuidv7 } from 'uuid';
import {OrderFailed, ProcessPayment} from "@shared/messages/message";
import {IsNotEmpty} from "@nestjs/class-validator";
import {PaymentProcessed} from "@infrastructure/messaging/sagas/OrderProcessingStateMachine";
import { BusTransitConsumer, IPublishEndpoint, ISagaConsumeContext } from "nestjs-bustransit";


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
        // if (randomRate > 0.2) {
        //     let paymentProcessed = new PaymentProcessed();
        //     paymentProcessed.OrderId = context.Message.OrderId;
        //     paymentProcessed.PaymentIntentId = `T_${uuidv7()}`;
        //     return await this.publishEndpoint.Send<PaymentProcessed>(paymentProcessed, ctx);
        // } else {
        //     let orderFailed = new OrderFailed();
        //     orderFailed.OrderId = context.Message.OrderId;
        //     orderFailed.Reason = "Payment failed";
        //     return await this.publishEndpoint.Send<OrderFailed>(orderFailed, ctx);
        // }

        let paymentProcessed = new PaymentProcessed();
            paymentProcessed.OrderId = context.Message.OrderId;
            paymentProcessed.PaymentIntentId = `T_${uuidv7()}`;
            return await this.publishEndpoint.Send<PaymentProcessed>(paymentProcessed, ctx);
    }
}