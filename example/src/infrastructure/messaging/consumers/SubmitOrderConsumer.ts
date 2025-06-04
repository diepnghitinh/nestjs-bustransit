import {Controller, Inject, Injectable, Logger} from "@nestjs/common";
import {IsNotEmpty} from "@nestjs/class-validator";
import {BusTransitConsumer} from "nestjs-bustransit";
import {IPublishEndpoint} from "nestjs-bustransit";

export class OrderMessage {
    @IsNotEmpty()
    Text: string;
}

class SubmitOrderConsumerDefinition {}

@Injectable()
export class SubmitOrderConsumer extends BusTransitConsumer<OrderMessage> {

    constructor(
        @Inject(IPublishEndpoint)
        private readonly publishEndpoint: IPublishEndpoint,
    ) {
        super(OrderMessage);
    }

    async Consume(ctx, context) {
        await super.Consume(ctx, context)
        Logger.debug('SubmitOrderConsumer receive')
        console.log(context.Message);
    }
}