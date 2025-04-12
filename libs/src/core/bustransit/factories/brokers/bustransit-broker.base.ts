import {IBusTransitBrokerInterface} from "@core/bustransit/interfaces/brokers/bustransit-broker-factory.interface";
import {IBusTransitBrokerOptions} from "@core/bustransit/interfaces/brokers/bustransit-broker.options.interface";

export class BusTransitBrokerBaseFactory implements IBusTransitBrokerInterface {

    protected consumers = {};

    public setBrokerConfig(brokerConfig: IBusTransitBrokerOptions) {}
    public setConsumers(consumers: any) {
        this.consumers = consumers;
    }

    public start() {}
    public startAllConsumer() {}

    public close() {}
}