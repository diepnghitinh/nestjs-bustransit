import {IConsumeContext} from "./consumer.interface";

export interface IEventCorrelationConfigurator<TSaga, TMessage> {
    CorrelateById(c: (c: IConsumeContext<TMessage>) => any): IEventCorrelationConfigurator<TSaga, TMessage>;
}