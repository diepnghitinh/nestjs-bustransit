import {IConsumeContext} from "@core/bustransit/interfaces/consumer.interface";

export interface ISagaConsumeContext<TState, TMessage> extends IConsumeContext<TMessage> , IMessageContext<TState> {
    Saga: TState,
    Message: TMessage,
}