import {DynamicModule, Inject, Logger, Module} from '@nestjs/common';
import { BusTransitCoreModule } from './bustransit.core';
import {BusTransitConsumer} from "./factories/consumer";
import {IAddBusTransit} from "./interfaces/bustransit";
import {RabbitMqBusFactoryConfigurator} from "./factories/rabbitmq-bus-factory.configurator";
import {PublishEndpoint} from "./factories/publish-endpoint";
import {BusTransitStateMachine} from "./factories/saga.bustransit.state-machine";
import {ConsumerRegistrationConfigurator} from "./factories/consumer.registration.configurator";
import {
    IConsumerRegistrationConfigurator
} from "./interfaces/consumer.registration.configurator.interface";
import {IBustransitModuleOptions} from "./interfaces/bustransit.module.interface";

@Module({})
export class BusTransitModule {
    static forFeatureAsync(configure: IBustransitModuleOptions): DynamicModule {
        return {
            module: BusTransitModule,
            imports: [
                configure.module,
            ],
            providers: [
                ...configure.inject
            ],
            exports: [],
        };
    }
}