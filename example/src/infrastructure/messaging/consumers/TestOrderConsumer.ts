import {Controller, Inject, Injectable, Logger} from "@nestjs/common";
import { BusTransitConsumer, IPublishEndpoint } from "nestjs-bustransit";

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

    async Consume(ctx, context) {
        const randomNumber = Math.random() * 50;
        console.log(`ok ${randomNumber} - ` + new Date())
        if (randomNumber < 40) {
            throw new Error("Very bad things happened")
        }
        console.log(context.Message)
    }
}