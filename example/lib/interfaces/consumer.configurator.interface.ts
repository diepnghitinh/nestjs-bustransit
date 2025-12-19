import {IRetryConfigurator} from "./retry.configurator.interface";

export interface IConsumerConfigurator {
    UseMessageRetry(c: (c: IRetryConfigurator) => void);
    UseDelayedRedelivery(c: (c: IRetryConfigurator) => void);
}