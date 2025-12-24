
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
import { BusTransit, RoutingSlipBusConfigurator, SagaPersistenceModule, SagaPersistenceType } from 'nestjs-bustransit';
import { ProcessPaymentActivity } from '@infrastructure/messaging/routing-slips/activities/ProcessPaymentActivity';
import { ReserveInventoryActivity } from '@infrastructure/messaging/routing-slips/activities/ReserveInventoryActivity';
import { SendConfirmationActivity } from '@infrastructure/messaging/routing-slips/activities/SendConfirmationActivity';
import { ValidateInventoryActivity } from '@infrastructure/messaging/routing-slips/activities/ValidateInventoryActivity';

const configService = new ConfigService();

@Global()
@Module({
    imports: [
        // SagaPersistenceModule.forRoot({
        //     type: SagaPersistenceType.MongoDB,
        //     connection: {
        //         uri: 'mongodb+srv://d3companyproduct_db_user:X347Ic74sGR0DTbI@cluster0.yt2jklc.mongodb.net/?appName=Cluster0',
        //         database: 'bustransit',
        //         collectionName: 'saga_states'
        //     },
        //     autoArchive: true,
        //     archiveTTL: 86400 * 30 // 30 days
        // }),
        // Or use PostgreSQL
        // SagaPersistenceModule.forRoot({
        //     type: SagaPersistenceType.PostgreSQL,
        //     connection: {
        //     host: 'localhost',
        //     port: 5432,
        //     username: 'postgres',
        //     password: 'postgres',
        //     database: 'bustransit'
        //     },
        //     autoArchive: true
        // }),
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

            // Configure Routing Slip Activities
            // This automatically detects the mode from RoutingSlipModule.forRoot() in app.module.ts
            // - InProcess mode: Consumers are automatically skipped
            // - Distributed mode: Consumers are automatically registered
            RoutingSlipBusConfigurator.configure(x, {
                queuePrefix: 'myapp',
                activities: [
                    ProcessPaymentActivity,
                    ReserveInventoryActivity,
                    SendConfirmationActivity,
                    ValidateInventoryActivity
                ]
            });

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

                // Configure Routing Slip Activity Endpoints
                // This automatically detects the mode from RoutingSlipModule.forRoot()
                // - InProcess mode: Endpoints are automatically skipped
                // - Distributed mode: Endpoints are automatically configured
                RoutingSlipBusConfigurator.configureEndpoints(cfg, context, {
                    queuePrefix: 'myapp',
                    activities: [
                        ProcessPaymentActivity,
                        ReserveInventoryActivity,
                        SendConfirmationActivity,
                        ValidateInventoryActivity
                    ]
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

