interface IConsumerConfigurator {
    UseMessageRetry(c: (c: IRetryConfigurator) => void);
    UseDelayedRedelivery(c: (c: IRetryConfigurator) => void);
}