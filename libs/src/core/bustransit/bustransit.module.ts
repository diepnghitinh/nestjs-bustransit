import { DynamicModule, Logger, Module } from '@nestjs/common';
import { BusTransitCoreModule } from './bustransit.core';
import { BusTransitModuleOptionsRabbitMq_Factory } from './factories/bustransit-options';
import { BusTransitAdapterRabbitMqConfig } from './factories/bustransit-adapter.rabbitmq.config';

export namespace BusTransit {

    export interface IAddBusTransit {
        UsingRabbitMq(optionsFunc: BusTransitModuleOptionsRabbitMq_Factory);
        AddConsumer<T>(): void;
    }

    type AddBusTransitFunction = (x: IAddBusTransit) => void;

    @Module({})
    export class AddBusTransit {

        private _busTransitAdapterRabbitMqConfig: BusTransitAdapterRabbitMqConfig;

        static Setup(optionsFunc: AddBusTransitFunction): DynamicModule {
            const _instance = new AddBusTransit();
            optionsFunc(_instance)

            return {
                module: BusTransit.AddBusTransit,
                imports: [BusTransitCoreModule.forRoot(_instance._busTransitAdapterRabbitMqConfig.getOptions())],
                exports: [],
            };
        }

        UsingRabbitMq(optionsFunc: BusTransitModuleOptionsRabbitMq_Factory) {
            Logger.debug('RabbitMQ Host Configured');
            this._busTransitAdapterRabbitMqConfig = new BusTransitAdapterRabbitMqConfig();
            optionsFunc(this, this._busTransitAdapterRabbitMqConfig)
        }

        AddConsumer<T = any>() : void {
            Logger.debug('AddConsumer')
            // return {
            //     module: BusTransit.AddBusTransit,
            //     imports: [],
            //     exports: [],
            // };
            return null;
        }
    }
}
