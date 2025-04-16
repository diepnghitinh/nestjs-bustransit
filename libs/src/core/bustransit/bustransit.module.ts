import { DynamicModule, Logger, Module } from '@nestjs/common';
import { BusTransitCoreModule } from './bustransit.core';
import {BusTransitConsumer} from "@core/bustransit/factories/consumer";
import {IAddBusTransit} from "@core/bustransit/interfaces/bustransit";
import {RabbitMqBusFactoryConfigurator} from "@core/bustransit/factories/rabbitmq-bus-factory.configurator";
import {PublishEndpoint} from "@core/bustransit/factories/publish-endpoint";
import {SubmitOrderConsumer} from "@infrastructure/messaging/consumers/SubmitOrderConsumer";
import {TestOrderConsumer} from "@infrastructure/messaging/consumers/TestOrderConsumer";

export namespace BusTransit {

    @Module({})
    export class AddBusTransit implements IAddBusTransit {

        private _rabbitMqBusFactoryConfigurator: RabbitMqBusFactoryConfigurator;
        private _consumers = {};
        private _consumersBindQueue = {};

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

        UsingRabbitMq(configure: (ctx, x: IRabbitMqBusFactoryConfigurator) => void) {
            Logger.debug('** RabbitMQ Host Configured');
            this._rabbitMqBusFactoryConfigurator = new RabbitMqBusFactoryConfigurator();
            configure(this, this._rabbitMqBusFactoryConfigurator)
            this.start();
        }

        AddConsumer<T extends BusTransitConsumer<any>>(consumerClass: new (...args: any[]) => T): void {
            Logger.debug(`** Added Consumer [${consumerClass.name}]`)
            //const consumerInstance = new consumerClass();
            this._consumers[consumerClass.name] = consumerClass;
            return null;
        }

        start() {
            Logger.debug('BusTransit started')
            // Logger.debug(this._rabbitMqBusFactoryConfigurator.getOptions());
        }

        get consumers() {
            return this._consumers;
        }
    }
}
