export interface IBusTransitConsumer<TMessage> {
    Consume(context);
}