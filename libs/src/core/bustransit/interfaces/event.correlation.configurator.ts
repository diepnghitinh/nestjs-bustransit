import {IConsumeContext} from "@core/bustransit/interfaces/consumer.interface";

export interface IEventCorrelationConfigurator<TSaga, TMessage> {
    CorrelateById(c: (c: IConsumeContext<TMessage>) => any): IEventCorrelationConfigurator<TSaga, TMessage>;
}