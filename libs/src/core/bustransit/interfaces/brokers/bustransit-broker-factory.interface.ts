import {IBusTransitBrokerOptions} from "@core/bustransit/interfaces/brokers/bustransit-broker.options.interface";

export interface IBusTransitBrokerInterface {
    start(): void;
    setBrokerConfig(brokerConfig: IBusTransitBrokerOptions);
}