import {IEventCorrelationConfigurator} from "@core/bustransit/interfaces/event.correlation.configurator";
import {IConsumeContext} from "@core/bustransit/interfaces/consumer.interface";
import {BehaviorContext} from "@core/bustransit/factories/behavior.context";

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