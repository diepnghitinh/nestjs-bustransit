import {IBusTransitConsumer, IConsumeContext} from "@core/bustransit/interfaces/consumer.interface";
import {parseClassAndValidate} from "@core/bustransit/factories/bustransit.utils";

export abstract class BusTransitConsumer<TMessage extends object> implements IBusTransitConsumer<TMessage> {

    protected message;

    protected constructor(messageClass: new (...args: any[]) => TMessage) {
        this.message = messageClass;
    }

    async Consume(context: IConsumeContext<TMessage>) {
        const msg = await this.getMessage(context)
        context.Message = msg;
        throw new Error("Method not implemented.");
    }

    async getMessage(context: IConsumeContext<TMessage>): Promise<TMessage> {
        return await parseClassAndValidate(this.message, context.Message);
    }
}