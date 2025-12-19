import {IEventActivityBinder} from "./event.activity-binder.interface";
import {IEventCorrelationConfigurator} from "./event.correlation.configurator";
import {IEvent} from "./saga";
import {BehaviorContext} from "../factories/behavior.context";
import {SagaStateMachineInstance} from "../factories/saga.state-machine-instance";

export interface IBusTransitStateMachine<TSaga extends object> {
    get GetEvents(): any;
    Event<T>(eventClass: IEvent<T>, selector: (selector: IEventCorrelationConfigurator<TSaga, any>) => void);
    Initially(when: IEventActivityBinder<TSaga, any>): void;
    Compensate<TMessage extends TSaga>(ctx: BehaviorContext<SagaStateMachineInstance, TMessage>): Promise<void>;
}