import {DynamicModule, Inject, Logger, Module} from '@nestjs/common';
import { BusTransitCoreModule } from './bustransit.core';
import {BusTransitConsumer} from "@core/bustransit/factories/consumer";
import {IAddBusTransit} from "@core/bustransit/interfaces/bustransit";
import {RabbitMqBusFactoryConfigurator} from "@core/bustransit/factories/rabbitmq-bus-factory.configurator";
import {PublishEndpoint} from "@core/bustransit/factories/publish-endpoint";
import {BusTransitStateMachine} from "@core/bustransit/factories/saga.bustransit.state-machine";
import {ConsumerRegistrationConfigurator} from "@core/bustransit/factories/consumer.registration.configurator";
import {
    IConsumerRegistrationConfigurator
} from "@core/bustransit/interfaces/consumer.registration.configurator.interface";

export namespace BusTransit {

    @Module({})
    export class AddBusTransit implements IAddBusTransit {

        private _rabbitMqBusFactoryConfigurator: RabbitMqBusFactoryConfigurator;
        private _consumers = {};
        private _consumersBindQueue = {};

        /* name : consumer object */
        private _sagasConsumers = {}; // Now: support exchange from saga

        static Setup(configure: (x: IAddBusTransit) => void): DynamicModule {
            const _instance = new AddBusTransit();
            configure(_instance)

            return {
                module: BusTransit.AddBusTransit,
                imports: [
                    BusTransitCoreModule.forRoot(
                        _instance._rabbitMqBusFactoryConfigurator.getOptions(),
                        _instance.consumers,
                        _instance._consumersBindQueue,
                    ),
                ],
                providers: [
                    PublishEndpoint,
                ],
                exports: [],
            };
        }

        UsingRabbitMq(clusterName: string, configure: (ctx, x: IRabbitMqBusFactoryConfigurator) => void) {
            Logger.debug('** RabbitMQ Host Configured');
            this._rabbitMqBusFactoryConfigurator = new RabbitMqBusFactoryConfigurator();
            this._rabbitMqBusFactoryConfigurator.setClusterName(clusterName);
            configure(this, this._rabbitMqBusFactoryConfigurator)
            this.start();
        }

        AddConsumer<T extends BusTransitConsumer<any>>(consumerClass: new (...args: any[]) => T): IConsumerRegistrationConfigurator<T> {
            Logger.debug(`** Added Consumer [${consumerClass.name}]`)
            this._consumers[consumerClass.name] = consumerClass;
            let cfg = new ConsumerRegistrationConfigurator(consumerClass);
            return cfg;
        }

        AddSagaStateMachine<TSagaMachine extends BusTransitStateMachine<any>, TSaga>(
            machineClass: new (...args: any[]) => TSagaMachine,
            stateClass: new (...args: any[]) => TSaga,
        ): IConsumerRegistrationConfigurator<TSagaMachine> {
            Logger.debug(`** Added SagaMachine [${stateClass.name}]`)
            this._consumers[machineClass.name] = machineClass;
            this._sagasConsumers[stateClass.name] = machineClass;
            let cfg = new ConsumerRegistrationConfigurator(machineClass);
            return cfg;
        }

        start() {
            Logger.debug('BusTransit started')
            // Logger.debug(this._rabbitMqBusFactoryConfigurator.getOptions());
        }

        get consumers() {
            return this._consumers;
        }

        get sagasConsumers() {
            return this._sagasConsumers;
        }
    }
}
