import {IBusTransitBrokerOptions} from "@core/bustransit/interfaces/brokers/bustransit-broker.options.interface";
import {BehaviorContext} from "@core/bustransit/factories/behavior.context";

export interface IBusTransitBrokerInterface {
    start(): void;
    publish<TMessage>(message: TMessage, ctx: BehaviorContext<any, TMessage>): any;
    publishAsync<TMessage>(message: TMessage, ctx: BehaviorContext<any, TMessage>): Promise<any>;
    setBrokerConfig(brokerConfig: IBusTransitBrokerOptions);
}