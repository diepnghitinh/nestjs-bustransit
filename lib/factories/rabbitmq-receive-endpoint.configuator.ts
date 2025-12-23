import {Logger} from "@nestjs/common";
import {ConsumerConfigurator} from "./consumer.configurator";
import {SagaConfigurator} from "./saga.configurator";
import {IRabbitMqReceiveEndpointConfigurator} from "../interfaces/rabbitmq-receive-endpoint.configuator.interface";
import {ISagaConfigurator} from "../interfaces/saga.configurator.interface";
import {IConsumerConfigurator} from "../interfaces/consumer.configurator.interface";

export class RabbitMqReceiveEndpointConfigurator implements
    IRabbitMqReceiveEndpointConfigurator
{
    private queueName: string;

    PrefetchCount: number;
    AutoDelete: boolean;
    Durable: boolean;
    ExchangeType: string;
    PurgeOnStartup: boolean;

    set QueueName(value: string) {
        this.queueName = value;
    }

    SetExchangeArgument(key: string, value: any) {

    }

    ConfigureConsumer<T>(consumer: T, ctx, c: (c: IConsumerConfigurator) => void) {
        let consumerData = ctx.consumers[(consumer as any).name] ?? (consumer as any).name;
        // Extract class if it's a saga consumer data object
        let consumerBind = consumerData?.machineClass || consumerData;

        const consumerConfigurator = new ConsumerConfigurator();
        consumerConfigurator.bindQueue(this.queueName);
        consumerConfigurator.bindConsumer(consumerBind);
        consumerConfigurator.setOptions({
            PrefetchCount: this.PrefetchCount,
        })

        /*
            queueName là key, vì 1 consumer class có thể được sử dụng cho nhiều queue
         */
        ctx._consumersBindQueue[this.queueName] = consumerConfigurator;
        Logger.debug(`ConfigureConsumer: ${this.queueName} <- ${consumerBind.name}`);
        c(consumerConfigurator)
    }

    ConfigureSaga<T>(stateClass: { new(...args: any[]): T }, ctx, c: (c: ISagaConfigurator) => void) {
        const sagaConfigurator = new SagaConfigurator();
        sagaConfigurator.bindQueue(this.queueName);

        // Get the saga consumer data (might be object with machineClass/stateClass or just the class)
        const sagaConsumerData = ctx.consumers[ctx.sagasConsumers[stateClass.name].name];
        const machineClass = sagaConsumerData?.machineClass || sagaConsumerData;

        sagaConfigurator.bindConsumer(machineClass);
        sagaConfigurator.setOptions({
            PrefetchCount: this.PrefetchCount,
        })
        ctx._consumersBindQueue[this.queueName] = sagaConfigurator;
        Logger.debug(`ConfigureSaga: ${this.queueName} <- ${sagaConfigurator.consumer.name}`);
        c(sagaConfigurator)
    }
}

