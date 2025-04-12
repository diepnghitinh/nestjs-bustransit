import {IBusTransitBrokerInterface} from "@core/bustransit/interfaces/brokers/bustransit-broker-factory.interface";
import {IBusTransitBrokerOptions} from "@core/bustransit/interfaces/brokers/bustransit-broker.options.interface";

export class BusTransitBrokerBaseFactory implements IBusTransitBrokerInterface {
    public start() {}
    public setBrokerConfig(brokerConfig: IBusTransitBrokerOptions) {}
}