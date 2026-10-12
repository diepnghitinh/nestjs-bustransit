import {BehaviorContext} from "../../factories/behavior.context";
import {IBusTransitBrokerOptions} from "./bustransit-broker.options.interface";
import {BusTransitHealth} from "./bustransit-health.interface";

export interface IBusTransitBrokerInterface {
    start(): Promise<void>;
    /** Final: stops consuming for good (shutdown). Publishing keeps working until close(). */
    stopConsuming(): Promise<void>;
    close(): Promise<void>;
    health(): BusTransitHealth;
    publish<TMessage>(message: TMessage, ctx?: BehaviorContext<any, TMessage>): Promise<void>;
    publishAsync<TMessage>(message: TMessage, ctx?: BehaviorContext<any, TMessage>): Promise<any>;
    setBrokerConfig(brokerConfig: IBusTransitBrokerOptions);
}
