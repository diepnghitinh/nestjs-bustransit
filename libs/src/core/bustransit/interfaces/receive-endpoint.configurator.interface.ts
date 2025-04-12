interface IReceiveEndpointConfigurator {
    set PrefetchCount(value: number);
    ConfigureConsumer<T>(ctx, c: (c: IConsumerConfigurator) => void);
}