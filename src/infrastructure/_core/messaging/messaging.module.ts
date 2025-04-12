import {BusTransit} from '@core/bustransit';
import { Global, Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import '@configs/messaging.config';
import {SubmitOrderConsumer} from "@infrastructure/messaging/consumers/SubmitOrderConsumer";

const configService = new ConfigService();

@Global()
@Module({
    imports: [
        BusTransit.AddBusTransit.Setup((x) => {

            x.AddConsumer(SubmitOrderConsumer);

            x.UsingRabbitMq((context, cfg) =>
            {
                cfg.setName(configService.get('APP_NAME'));

                cfg.PrefetchCount = 50;
                cfg.Durable = true;

                cfg.Host(configService.get('RMQ_HOST'), configService.get('RMQ_VHOST'), (h) =>
                {
                    h.Username(configService.get('RMQ_USERNAME'));
                    h.Password(configService.get('RMQ_PASSWORD'));
                });

                cfg.ReceiveEndpoint("regular-orders", e => {

                    e.ConfigureConsumer<SubmitOrderConsumer>(context, c => {
                        c.UseMessageRetry();
                    });

                });
            })
        }),
    ],
    controllers: [],
    providers: [],
})
export class MessagingInfrastructureModule {}

