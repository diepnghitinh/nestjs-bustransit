import {IEventActivityBinder} from "@core/bustransit/interfaces/event.activity-binder.interface";
import {IEventCorrelationConfigurator} from "@core/bustransit/interfaces/event.correlation.configurator";

export interface IBusTransitStateMachine<TSaga extends object> {
    get GetEvents(): any;
    Event<T>(eventClass: IEvent<T>, selector: (selector: IEventCorrelationConfigurator<TSaga, any>) => void);
    Initially(when: IEventActivityBinder<TSaga, any>): void;
}