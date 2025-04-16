export interface IBusTransitConsumer<TMessage> {
    Consume(context: IConsumeContext<TMessage>);
}

export interface IConsumeContext<TMessage> {
    Message: TMessage
}