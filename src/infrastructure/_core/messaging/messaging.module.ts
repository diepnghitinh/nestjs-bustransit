import {BusTransit} from '@core/bustransit';
import { Global, Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import '@configs/messaging.config';
import {IBusTransitConsumer} from "@core/bustransit/interfaces/_consumer";

const configService = new ConfigService();

class Message {}
//
// export class SubmitOrderConsumer implements IBusTransitConsumer<Message> {
//     Consume(context){
//         Logger.debug('SubmitOrderConsumer running')
//     }
// }

@Global()
@Module({
    imports: [
        BusTransit.AddBusTransit.Setup((x) => {
            //x.AddConsumer(SubmitOrderConsumer);

            x.UsingRabbitMq((context, cfg) =>
            {
                cfg.PrefetchCount = 50;
                cfg.Durable = true;

                cfg.Host(configService.get('RMQ_HOST'), configService.get('RMQ_VHOST'), (h) =>
                {
                    h.Username(configService.get('RMQ_USERNAME'));
                    h.Password(configService.get('RMQ_PASSWORD'));
                });

                cfg.ReceiveEndpoint("regular-orders", e => {

                    // e.ConfigureConsumer<SubmitOrderConsumer>(context, c => {
                    //     // c.UseMessageRetry(r => r.Interval(5, 1000))
                    //     Logger.debug('asas')
                    // })

                    e.ConfigureConsumer(context, c => {
                        Logger.debug('ConfigureConsumer')
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

