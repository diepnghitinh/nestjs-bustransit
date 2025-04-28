import {BehaviorContext} from "@core/bustransit/factories/behavior.context";

export interface IBusTransitConsumer<TMessage> {
    get GetMessageClass(): TMessage;
    Consume(ctx: BehaviorContext<any, TMessage>, context: IConsumeContext<TMessage>): Promise<any>;
}

export interface IConsumeContext<TMessage> extends IMessageContext<TMessage> {
    Message: TMessage,
    fields: any,
}