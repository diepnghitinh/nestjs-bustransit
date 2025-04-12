import {Logger} from "@nestjs/common";
import {ConsumerConfigurator} from "@core/bustransit/factories/consumer.configurator";

export class RabbitMqReceiveEndpointConfigurator implements
    IRabbitMqReceiveEndpointConfigurator
{
    AutoDelete: boolean;
    Durable: boolean;
    ExchangeType: string;
    PurgeOnStartup: boolean;

    ConfigureConsumer<T>(ctx, c: (c: IConsumerConfigurator) => void) {
        Logger.debug('ConfigureConsumer');
        const consumerConfigurator = new ConsumerConfigurator();
        c(consumerConfigurator)
    }

    set PrefetchCount(value: number) {
    }

    SetExchangeArgument(key: string, value: any) {
    }
}

