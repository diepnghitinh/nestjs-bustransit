import {ISagaConfigurator} from "./saga.configurator.interface";
import {IConsumerConfigurator} from "./consumer.configurator.interface";

export interface IReceiveEndpointConfigurator {

    /// <summary>
    /// Specify the number of messages to prefetch from the message broker
    /// </summary>
    /// <value>The limit</value>
    PrefetchCount: number;

    ConfigureConsumer<T>(genericClass: new (...args: any[]) => T, ctx, c: (c: IConsumerConfigurator) => void);

    ConfigureSaga<T>(genericClass: new (...args: any[]) => T, ctx, c: (c: ISagaConfigurator) => void);
}