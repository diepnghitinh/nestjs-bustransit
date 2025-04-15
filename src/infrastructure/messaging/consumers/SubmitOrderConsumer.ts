import {Controller, Inject, Injectable, Logger} from "@nestjs/common";
import {IBusTransitConsumer} from "@core/bustransit/interfaces/consumer.interface";
import {IPublishEndpoint} from "@core/bustransit/interfaces/publish-endpoint.interface";

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