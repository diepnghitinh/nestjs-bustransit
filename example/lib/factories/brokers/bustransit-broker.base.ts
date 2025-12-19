import {ModuleRef} from "@nestjs/core";
import {IBusTransitBrokerInterface} from "../../interfaces/brokers/bustransit-broker-factory.interface";
import {IBusTransitBrokerOptions} from "../../interfaces/brokers/bustransit-broker.options.interface";
import {BusTransitStateMachine} from "../saga.bustransit.state-machine";
import {BehaviorContext} from "../behavior.context";

export class BusTransitBrokerBaseFactory implements IBusTransitBrokerInterface {

    protected consumers = {};
    protected consumersToEndpoint = {};
    protected messagesToEndpoint = {};
    protected classConsumerToEndpoint = {};
    protected classMessageToEndpoint = {};
    protected classMessageToExchange = {};
    protected sagas = {};
    protected moduleRef: ModuleRef;

    public setBrokerConfig(brokerConfig: IBusTransitBrokerOptions) {}
    public setModuleRef(moduleRef) {
        this.moduleRef = moduleRef;
    }
    public setConsumers(consumers: any, consumersToEndpoint: any, messagesToEndpoint: any) {
        this.consumers = consumers;
        this.consumersToEndpoint = consumersToEndpoint;
        this.messagesToEndpoint = messagesToEndpoint;
        Object.entries( this.consumers ).map((key, value) => {
            if (Object.getPrototypeOf(key[1]) === BusTransitStateMachine) {
                this.sagas[key[0]] = key[1]
            }
        });
        Object.entries( this.messagesToEndpoint ).map((key, value) => {
            this.classMessageToEndpoint[key[0]] = key[1]
        });
    }

    public get Consumers() {
        return this.consumers;
    };

    public start() {}
    public startAllConsumer() {}

    public close() {
    }

    // Message functions
    async publish<TMessage>(message: TMessage, ctx: BehaviorContext<any, TMessage>): Promise<any> {
        throw Error('Function implement')
    }

    async publishAsync<TMessage>(message: TMessage, ctx: BehaviorContext<any, TMessage>): Promise<any> {
        throw Error('Function implement')
    }
}