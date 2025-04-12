export interface IBusTransitConsumer<TMessage> {
    Consume(context);
}

export interface IBusTransitConsumerConfigurator {
    UseMessageRetry(r)
}