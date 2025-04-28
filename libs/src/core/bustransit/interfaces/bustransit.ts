import {BusTransitConsumer} from "@core/bustransit/factories/consumer";
import {BusTransitStateMachine} from "@core/bustransit/factories/saga.bustransit.state-machine";
import {
    IConsumerRegistrationConfigurator
} from "@core/bustransit/interfaces/consumer.registration.configurator.interface";

export interface IAddBusTransit {
    UsingRabbitMq(clusterName: string, configure: (ctx, x: IRabbitMqBusFactoryConfigurator) => void);
    AddConsumer<T extends BusTransitConsumer<any>, E>(consumerClass: new (...args: any[]) => T, consumerDefinition?: E): IConsumerRegistrationConfigurator<T>;
    AddSagaStateMachine<TSagaMachine extends BusTransitStateMachine<any>, TSaga>(
        machineClass: new (...args: any[]) => TSagaMachine,
        stateClass: new (...args: any[]) => TSaga,
    ): IConsumerRegistrationConfigurator<TSagaMachine>;
}