import {IEventCorrelationConfigurator} from "../interfaces/event.correlation.configurator";
import {IConsumeContext} from "../interfaces/consumer.interface";
import {BehaviorContext} from "./behavior.context";

export class EventCorrelationConfigurator<TSaga, TMessage> implements IEventCorrelationConfigurator<TSaga, TMessage> {
    private readonly context;
    constructor(ctx: BehaviorContext<TSaga, any>) {
        this.context = ctx;
    }

    CorrelateById(c: (c: IConsumeContext<TMessage>) => any): IEventCorrelationConfigurator<TSaga, TMessage> {
        this.context.Saga.CorrelationId = c(this.context)
        return this;
    }
}