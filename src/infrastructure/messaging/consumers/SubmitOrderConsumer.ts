import {Controller, Inject, Injectable, Logger} from "@nestjs/common";
import {IBusTransitConsumer, IConsumeContext} from "@core/bustransit/interfaces/consumer.interface";
import {IPublishEndpoint} from "@core/bustransit/interfaces/publish-endpoint.interface";
import {BusTransitConsumer} from "@core/bustransit/factories/consumer";
import {plainToClass, plainToClassFromExist} from "@nestjs/class-transformer";
import {parseClassAndValidate} from "@core/bustransit/factories/bustransit.utils";
import {IsNotEmpty} from "@nestjs/class-validator";

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