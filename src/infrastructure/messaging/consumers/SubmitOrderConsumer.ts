import {Controller, Inject, Injectable, Logger} from "@nestjs/common";
import {IBusTransitConsumer} from "@core/bustransit/interfaces/consumer.interface";
import {IPublishEndpoint} from "@core/bustransit/interfaces/publish-endpoint.interface";
import {RabbitSubscribe} from "@core/bustransit/decorator/subscriber.decorator";
import {TestOrderConsumer} from "@infrastructure/messaging/consumers/TestOrderConsumer";
import {MessagePattern, Payload} from "@nestjs/microservices";

class Message {
    Text: string;
}

class SubmitOrderConsumerDefinition {}

@Injectable()
export class SubmitOrderConsumer implements IBusTransitConsumer<Message> {

    constructor(
        @Inject(IPublishEndpoint)
        private readonly publishEndpoint: IPublishEndpoint,
    ) {}

    Consume(context) {
        Logger.debug('SubmitOrderConsumer receive')
        console.log(this.publishEndpoint);
        this.publishEndpoint.Publish<any>({})
    }
}

@Controller()
export class SubmitOrderConsumerController {

    @RabbitSubscribe(SubmitOrderConsumer)
    Observer() {
        Logger.debug('TestOrderConsumer end')
    }
}