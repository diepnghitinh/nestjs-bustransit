import {BehaviorContext} from "../../factories/behavior.context";
import {IBusTransitBrokerOptions} from "./bustransit-broker.options.interface";
import {IPublishOptions} from "../publisher-options.interface";


export interface IBusTransitBrokerInterface {
    start(): void;
    publish<TMessage>(message: TMessage, ctx: BehaviorContext<any, TMessage>, options?: IPublishOptions): Promise<any>;
    publishAsync<TMessage>(message: TMessage, ctx: BehaviorContext<any, TMessage>): Promise<any>;
    setBrokerConfig(brokerConfig: IBusTransitBrokerOptions);
}
