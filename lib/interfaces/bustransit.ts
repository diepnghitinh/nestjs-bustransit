import {
    IConsumerRegistrationConfigurator
} from "./consumer.registration.configurator.interface";
import {IRabbitMqBusFactoryConfigurator} from "./rabbitmq-bus-factory.configurator.interface";
import {BusTransitConsumer, BusTransitStateMachine} from "../factories";

export interface IAddBusTransit {
    UsingRabbitMq(clusterName: string, configure: (ctx, x: IRabbitMqBusFactoryConfigurator) => void);
    AddConsumer<T extends BusTransitConsumer<any>, E>(consumerClass: new (...args: any[]) => T, consumerDefinition?: E): IConsumerRegistrationConfigurator<T>;
    AddSagaStateMachine<TSagaMachine extends BusTransitStateMachine<any>, TSaga>(
        machineClass: new (...args: any[]) => TSagaMachine,
        stateClass: new (...args: any[]) => TSaga,
    ): IConsumerRegistrationConfigurator<TSagaMachine>;
}