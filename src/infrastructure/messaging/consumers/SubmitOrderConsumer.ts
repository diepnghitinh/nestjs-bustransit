import {Logger} from "@nestjs/common";
import {IBusTransitConsumer} from "@core/bustransit/interfaces/consumer.interface";

class Message {
    Text: string;
}

export class SubmitOrderConsumer implements IBusTransitConsumer<Message> {
    Consume(context) {
        Logger.debug('SubmitOrderConsumer running')
        Logger.log(context)
    }
}