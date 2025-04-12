import {IBusTransitConsumer} from "@core/bustransit/interfaces/_consumer";
import {Logger} from "@nestjs/common";

class Message {
    Text: string;
}

export class SubmitOrderConsumer implements IBusTransitConsumer<Message> {
    Consume(context){
        Logger.debug('SubmitOrderConsumer running')
    }
}