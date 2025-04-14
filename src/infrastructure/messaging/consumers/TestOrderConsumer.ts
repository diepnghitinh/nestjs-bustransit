import {Controller, Inject, Injectable, Logger} from "@nestjs/common";
import {IBusTransitConsumer} from "@core/bustransit/interfaces/consumer.interface";
import {IPublishEndpoint} from "@core/bustransit/interfaces/publish-endpoint.interface";
import {SubmitOrderConsumer} from "@infrastructure/messaging/consumers/SubmitOrderConsumer";
import {RabbitSubscribe} from "@core/bustransit/decorator/subscriber.decorator";

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
        Logger.debug('TestOrderConsumer receive')
    }
}

@Controller()
export class TestOrderConsumerController {

    @RabbitSubscribe(TestOrderConsumer)
    Observer() {
        Logger.debug('TestOrderConsumer end')
    }
}