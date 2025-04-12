interface IReceiveEndpointConfigurator {
    set PrefetchCount(value: number);
    ConfigureConsumer<T>(genericClass: new (...args: any[]) => T, ctx, c: (c: IConsumerConfigurator) => void);
}