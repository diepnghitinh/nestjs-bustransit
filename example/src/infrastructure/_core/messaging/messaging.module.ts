
import {Global, Logger, Module, Provider} from '@nestjs/common';
import {ConfigModule, ConfigService} from '@nestjs/config';
import '@configs/messaging.config';
import {
    SubmitOrderConsumer,
} from "@infrastructure/messaging/consumers/SubmitOrderConsumer";
import {TestOrderConsumer} from "@infrastructure/messaging/consumers/TestOrderConsumer";
import {OrderState, OrderStateMachine} from "@infrastructure/messaging/sagas/OrderProcessingStateMachine";
import {ProcessPaymentConsumer} from "@infrastructure/messaging/sagas/ProcessPaymentConsumer";
import {ReserveInventoryConsumer} from "@infrastructure/messaging/sagas/ReserveInventoryConsumer";
import {OrderRefundConsumer} from "@infrastructure/messaging/sagas/OrderRefundConsumer";
import {OrderConfirmedConsumer} from "@infrastructure/messaging/sagas/OrderConfirmedConsumer";
import { BusTransit } from 'nestjs-bustransit';

const configService = new ConfigService();

@Global()
@Module({
    imports: [
        BusTransit.AddBusTransit.setUp((x) => {

            x.AddConsumer(SubmitOrderConsumer,);
            x.AddConsumer(TestOrderConsumer,);

            // Other services
            x.AddConsumer(ProcessPaymentConsumer,).Endpoint(e => {
                e.Name = "saga-process-payment"
            });
            x.AddConsumer(ReserveInventoryConsumer,).Endpoint(e => {
                e.Name = "saga-reserve-inventory"
            });
            x.AddConsumer(OrderConfirmedConsumer,).Endpoint(e => {
                e.Name = "saga-order-confirmed"
            });
            x.AddConsumer(OrderRefundConsumer,).Endpoint(e => {
                e.Name = "saga-order-refund"
            });

            x.AddSagaStateMachine(OrderStateMachine, OrderState);

            // Sử dụng Name, các exchange sau này sẽ có dạng {APP_NAME}:{QUEUE} , {APP_NAME}:{EVENT...}
            x.UsingRabbitMq(configService.get('APP_NAME'), (context, cfg) =>
            {
                cfg.PrefetchCount = 50;

                cfg.Host(configService.get('RMQ_HOST'), configService.get('RMQ_VHOST'), (h) =>
                {
                    h.Username(configService.get('RMQ_USERNAME'));
                    h.Password(configService.get('RMQ_PASSWORD'));
                });

                cfg.ReceiveEndpoint("regular-orders-1", e => {
                    e.PrefetchCount = 30;
                    e.ConfigureConsumer(SubmitOrderConsumer, context, c => {
                        c.UseMessageRetry(r => r.Immediate(5));
                    });
                });

                cfg.ReceiveEndpoint("regular-orders-2", e => {
                    e.ConfigureConsumer(TestOrderConsumer, context, c => {
                        c.UseDelayedRedelivery(r => r.Intervals(5000, 15000, 30000));
                    });
                });

                cfg.ReceiveEndpoint("regular-order-saga", e => {
                    e.ConfigureSaga(OrderState, context, (c) => {
                    })
                });

                // Others services saga
                cfg.ReceiveEndpoint("saga-process-payment", e => {
                    e.ConfigureConsumer(ProcessPaymentConsumer, context, c => {
                    });
                });

                cfg.ReceiveEndpoint("saga-reserve-inventory", e => {
                    e.ConfigureConsumer(ReserveInventoryConsumer, context, c => {
                    });
                });

                cfg.ReceiveEndpoint("saga-order-confirmed", e => {
                    e.ConfigureConsumer(OrderConfirmedConsumer, context, c => {
                    });
                });

                cfg.ReceiveEndpoint("saga-order-refund", e => {
                    e.ConfigureConsumer(OrderRefundConsumer, context, c => {
                    });
                });
            })
        })
    ],
    controllers: [
    ],
    providers: [
    ],
})
export class MessagingInfrastructureModule {}

