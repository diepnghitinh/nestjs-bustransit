import {BusTransit} from '@core/bustransit';
import { Global, Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import '@configs/messaging.config';
import {IRabbitMqBusFactoryConfigurator} from '@core/bustransit/interfaces/bustransit-adapter.interface';

const configService = new ConfigService();

export class SubmitOrderConsumer {
    Consume(context){}
}

@Global()
@Module({
    imports: [
        BusTransit.AddBusTransit.Setup((x) => {
            x.AddConsumer<SubmitOrderConsumer>();
            x.UsingRabbitMq((context, cfg: IRabbitMqBusFactoryConfigurator) =>
            {
                cfg.PrefetchCount = 50;
                cfg.Durable = true;
                cfg.Host(configService.get('RMQ_HOST'), configService.get('RMQ_VHOST'), (h) =>
                {
                    h.Username(configService.get('RMQ_USERNAME'));
                    h.Password(configService.get('RMQ_PASSWORD'));
                });

                cfg.ReceiveEndpoint("regular-orders", e => {
                    // Bind exchange ???
                });
            })
        }),
    ],
    controllers: [],
    providers: [],
})
export class MessagingInfrastructureModule {}

