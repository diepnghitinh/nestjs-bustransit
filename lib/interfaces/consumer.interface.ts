import {BehaviorContext} from "../factories/behavior.context";
import {IMessageContext} from "./message.context.interface";

export interface IBusTransitConsumer<TMessage> {
    get GetMessageClass(): TMessage;
    Consume(ctx: BehaviorContext<any, TMessage>, context: IConsumeContext<TMessage>): Promise<any>;
}

export interface IConsumeContext<TMessage> extends IMessageContext<TMessage> {
    Message: TMessage,
    fields: any,
}