import { DynamicModule, Logger, Module } from '@nestjs/common';
import { BusTransitCoreModule } from './bustransit.core';
import {BusTransitConsumer} from "@core/bustransit/factories/consumer";
import {IAddBusTransit} from "@core/bustransit/interfaces/bustransit";
import {RabbitMqBusFactoryConfigurator} from "@core/bustransit/factories/rabbitmq-bus-factory.configurator";

export namespace BusTransit {

    @Module({})
    export class AddBusTransit implements IAddBusTransit {

        private _rabbitMqBusFactoryConfigurator: RabbitMqBusFactoryConfigurator;
        private _consumers = {};

        static Setup(configure: (x: IAddBusTransit) => void): DynamicModule {
            const _instance = new AddBusTransit();
            configure(_instance)

            Logger.debug('Setup finish')

            return {
                module: BusTransit.AddBusTransit,
                imports: [BusTransitCoreModule.forRoot(
                    _instance._rabbitMqBusFactoryConfigurator.getOptions(),
                    _instance.consumers,
                )],
                exports: [],
            };
        }

        UsingRabbitMq(configure: (ctx, x: IRabbitMqBusFactoryConfigurator) => void) {
            Logger.debug('** RabbitMQ Host Configured');
            this._rabbitMqBusFactoryConfigurator = new RabbitMqBusFactoryConfigurator();
            configure(this, this._rabbitMqBusFactoryConfigurator)
            this.start();
        }

        AddConsumer<T extends BusTransitConsumer<any>>(consumerClass: new (...args: any[]) => T): void {
            Logger.debug(`** Added Consumer [${consumerClass.name}]`)
            const consumerInstance = new consumerClass;
            this._consumers[consumerClass.name] = consumerInstance;
            return null;
        }

        start() {
            Logger.debug('BusTransit start')
            Logger.debug(this._rabbitMqBusFactoryConfigurator.getOptions());
        }

        get consumers() {
            return this._consumers;
        }
    }
}
