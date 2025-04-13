import {Logger} from "@nestjs/common";
import {ConsumerConfigurator} from "@core/bustransit/factories/consumer.configurator";

export class RabbitMqReceiveEndpointConfigurator implements
    IRabbitMqReceiveEndpointConfigurator
{
    private queueName: string;

    PrefetchCount: number;
    AutoDelete: boolean;
    Durable: boolean;
    ExchangeType: string;
    PurgeOnStartup: boolean;

    ConfigureConsumer<T>(consumer: T, ctx, c: (c: IConsumerConfigurator) => void) {
        const consumerConfigurator = new ConsumerConfigurator();

        consumerConfigurator.bindQueue(this.queueName);
        consumerConfigurator.bindConsumer(ctx.consumers[(consumer as any).name].Consume);
        consumerConfigurator.setOptions({
            PrefetchCount: this.PrefetchCount,
        })

        /*
            queueName là key, vì 1 consumer class có thể được sử dụng cho nhiều queue
         */
        ctx._consumersBindQueue[this.queueName] = consumerConfigurator;

        Logger.debug(`ConfigureConsumer: ${this.queueName}`);
        c(consumerConfigurator)
    }

    set QueueName(value: string) {
        this.queueName = value;
    }

    SetExchangeArgument(key: string, value: any) {

    }
}

