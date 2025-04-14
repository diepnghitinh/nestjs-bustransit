import {IBusTransitBrokerInterface} from "@core/bustransit/interfaces/brokers/bustransit-broker-factory.interface";
import {IBusTransitBrokerOptions} from "@core/bustransit/interfaces/brokers/bustransit-broker.options.interface";
import {ModuleRef} from "@nestjs/core";

export class BusTransitBrokerBaseFactory implements IBusTransitBrokerInterface {

    protected consumers = {};
    protected consumersBindQueue = {};
    protected moduleRef: ModuleRef;

    public setBrokerConfig(brokerConfig: IBusTransitBrokerOptions) {}
    public setConsumers(moduleRef, consumers: any, consumersBindQueue: any) {
        this.consumers = consumers;
        this.consumersBindQueue = consumersBindQueue;
        this.moduleRef = moduleRef;
    }

    public get Consumers() {
        return this.consumers;
    };
    public start() {}
    public startAllConsumer() {}

    public close() {}
}