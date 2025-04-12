import {Logger} from "@nestjs/common";
import {ConsumerConfigurator} from "@core/bustransit/factories/consumer.configurator";

export class RabbitMqReceiveEndpointConfigurator implements
    IRabbitMqReceiveEndpointConfigurator
{
    private queueName: string;

    AutoDelete: boolean;
    Durable: boolean;
    ExchangeType: string;
    PurgeOnStartup: boolean;

    ConfigureConsumer<T>(consumer: T, ctx, c: (c: IConsumerConfigurator) => void) {
        Logger.debug('ConfigureConsumer ');
        const consumerConfigurator = new ConsumerConfigurator();

        consumerConfigurator.bindQueue(this.queueName);
        consumerConfigurator.bindConsumer(ctx.consumers[(consumer as any).name].Consume);
        ctx._consumersBindQueue[(consumer as any).name] = this.queueName;

        c(consumerConfigurator)
    }

    set PrefetchCount(value: number) {

    }

    set QueueName(value: string) {
        this.queueName = value;
    }

    SetExchangeArgument(key: string, value: any) {

    }
}

