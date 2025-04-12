import {IBusTransitBrokerInterface} from "@core/bustransit/interfaces/brokers/bustransit-broker-factory.interface";
import {IBusTransitBrokerOptions} from "@core/bustransit/interfaces/brokers/bustransit-broker.options.interface";

export class BusTransitBrokerBaseFactory implements IBusTransitBrokerInterface {

    protected consumers = {};
    protected consumersBindQueue = {};

    public setBrokerConfig(brokerConfig: IBusTransitBrokerOptions) {}
    public setConsumers(consumers: any, consumersBindQueue: any) {
        this.consumers = consumers;
        this.consumersBindQueue = consumersBindQueue;
    }

    public start() {}
    public startAllConsumer() {}

    public close() {}
}