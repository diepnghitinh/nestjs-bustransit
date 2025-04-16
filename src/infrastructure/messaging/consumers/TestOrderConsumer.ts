import {Controller, Inject, Injectable, Logger} from "@nestjs/common";
import {IBusTransitConsumer} from "@core/bustransit/interfaces/consumer.interface";
import {IPublishEndpoint} from "@core/bustransit/interfaces/publish-endpoint.interface";
import {SubmitOrderConsumer} from "@infrastructure/messaging/consumers/SubmitOrderConsumer";
import {BusTransitConsumer} from "@core/bustransit/factories/consumer";

class Message2 {
    Text: string;
}

class SubmitOrderConsumerDefinition {}

@Injectable()
export class TestOrderConsumer extends BusTransitConsumer<Message2> {

    constructor(
        @Inject(IPublishEndpoint)
        private readonly publishEndpoint: IPublishEndpoint,
    ) {
        super(Message2);
    }

    async Consume(context) {
        const randomNumber = Math.random() * 100;
        if (randomNumber > 0) {
            throw new Error("Very bad things happened")
        }
    }
}