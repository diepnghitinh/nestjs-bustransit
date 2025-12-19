import {IReceiveConfigurator} from "./receive.configurator";

export interface IBusFactoryConfigurator<T> extends IReceiveConfigurator<T> {

    /// <summary>
    /// Specify the number of messages to prefetch from the message broker
    /// </summary>
    /// <value>The limit</value>
    set PrefetchCount(value: number);

    ConfigureEndpoints(ctx): void;

}