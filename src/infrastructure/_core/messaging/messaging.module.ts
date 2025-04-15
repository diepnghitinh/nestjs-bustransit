import {BusTransit} from '@core/bustransit';
import {Global, Logger, Module, Provider} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import '@configs/messaging.config';
import {
    SubmitOrderConsumer,
} from "@infrastructure/messaging/consumers/SubmitOrderConsumer";
import {TestOrderConsumer} from "@infrastructure/messaging/consumers/TestOrderConsumer";

const configService = new ConfigService();

@Global()
@Module({
    imports: [
        BusTransit.AddBusTransit.Setup((x) => {

            x.AddConsumer(SubmitOrderConsumer, );
            x.AddConsumer(TestOrderConsumer, );

            x.UsingRabbitMq((context, cfg) =>
            {
                cfg.setName(configService.get('APP_NAME'));

                cfg.PrefetchCount = 50;

                cfg.Host(configService.get('RMQ_HOST'), configService.get('RMQ_VHOST'), (h) =>
                {
                    h.Username(configService.get('RMQ_USERNAME'));
                    h.Password(configService.get('RMQ_PASSWORD'));
                });

                cfg.ReceiveEndpoint("regular-orders-1", e => {
                    e.PrefetchCount = 30;
                    e.ConfigureConsumer(SubmitOrderConsumer, context, c => {
                        c.UseMessageRetry();
                    });
                });

                cfg.ReceiveEndpoint("regular-orders-2", e => {
                    e.ConfigureConsumer(TestOrderConsumer, context, c => {
                        c.UseMessageRetry();
                    });
                });
            })
        }),
    ],
    controllers: [
    ],
    providers: [
    ],
})
export class MessagingInfrastructureModule {}

