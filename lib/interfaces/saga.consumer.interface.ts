import {IConsumeContext} from "./consumer.interface";
import {IMessageContext} from "./message.context.interface";

export interface ISagaConsumeContext<TState, TMessage> extends IConsumeContext<TMessage> , IMessageContext<TState> {
    Saga: TState,
    Message: TMessage,
}