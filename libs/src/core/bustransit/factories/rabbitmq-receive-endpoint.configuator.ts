import {Logger} from "@nestjs/common";
import {ConsumerConfigurator} from "@core/bustransit/factories/consumer.configurator";
import {SagaConfigurator} from "@core/bustransit/factories/saga.configurator";
import {TestOrderConsumer} from "@infrastructure/messaging/consumers/TestOrderConsumer";
import {BusTransitConsumer} from "@core/bustransit/factories/consumer";
import {RetryLevel} from "@core/bustransit/factories/retry.configurator";

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

