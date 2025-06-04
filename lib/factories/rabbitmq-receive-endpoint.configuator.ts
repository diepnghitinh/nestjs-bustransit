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
        let consumerBind = ctx.consumers[(consumer as any).name];
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
        sagaConfigurator.bindConsumer(ctx.consumers[ctx.sagasConsumers[stateClass.name].name]);
        sagaConfigurator.setOptions({
            PrefetchCount: this.PrefetchCount,
        })
        ctx._consumersBindQueue[this.queueName] = sagaConfigurator;
        Logger.debug(`ConfigureSaga: ${this.queueName} <- ${sagaConfigurator.consumer.name}`);
        c(sagaConfigurator)
    }
}

