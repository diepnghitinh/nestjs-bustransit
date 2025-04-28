import {IBusTransitBrokerInterface} from "@core/bustransit/interfaces/brokers/bustransit-broker-factory.interface";
import {IBusTransitBrokerOptions} from "@core/bustransit/interfaces/brokers/bustransit-broker.options.interface";
import {ModuleRef} from "@nestjs/core";
import {BusTransitStateMachine} from "@core/bustransit/factories/saga.bustransit.state-machine";
import {BusTransitConsumer} from "@core/bustransit/factories/consumer";
import {ConsumerConfigurator} from "@core/bustransit/factories/consumer.configurator";
import {BehaviorContext} from "@core/bustransit/factories/behavior.context";
import {EndpointRegistrationConfigurator} from "@core/bustransit/factories/endpoint.registration.configurator";

export class BusTransitBrokerBaseFactory implements IBusTransitBrokerInterface {

    protected consumers = {};
    protected consumersToEndpoint = {};
    protected classConsumerToEndpoint = {};
    protected classMessageToEndpoint = {};
    protected classMessageToExchange = {};
    protected sagas = {};
    protected moduleRef: ModuleRef;

    public setBrokerConfig(brokerConfig: IBusTransitBrokerOptions) {}
    public setModuleRef(moduleRef) {
        this.moduleRef = moduleRef;
    }
    public setConsumers(consumers: any, consumersToEndpoint: any) {
        this.consumers = consumers;
        this.consumersToEndpoint = consumersToEndpoint;
        Object.entries( this.consumers ).map((key, value) => {
            if (Object.getPrototypeOf(key[1]) === BusTransitStateMachine) {
                this.sagas[key[0]] = key[1]
            }
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