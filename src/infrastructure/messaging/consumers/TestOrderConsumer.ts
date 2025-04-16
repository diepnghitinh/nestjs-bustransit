import {Controller, Inject, Injectable, Logger} from "@nestjs/common";
import {IBusTransitConsumer} from "@core/bustransit/interfaces/consumer.interface";
import {IPublishEndpoint} from "@core/bustransit/interfaces/publish-endpoint.interface";
import {SubmitOrderConsumer} from "@infrastructure/messaging/consumers/SubmitOrderConsumer";

class Message2 {
    Text: string;
}

class SubmitOrderConsumerDefinition {}

@Injectable()
export class TestOrderConsumer implements IBusTransitConsumer<Message2> {

    constructor(
        @Inject(SubmitOrderConsumer)
        private readonly submitOrderConsumer: SubmitOrderConsumer
    ) {}

    Consume(context) {
        const randomNumber = Math.random() * 100;
        // if (randomNumber > 0) {
        //     throw new Error("Very bad things happened")
        // }
    }
}