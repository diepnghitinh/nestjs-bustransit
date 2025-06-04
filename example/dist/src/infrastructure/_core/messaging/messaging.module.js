"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.MessagingInfrastructureModule = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
require("../../../configs/messaging.config");
const SubmitOrderConsumer_1 = require("../../messaging/consumers/SubmitOrderConsumer");
const TestOrderConsumer_1 = require("../../messaging/consumers/TestOrderConsumer");
const OrderProcessingStateMachine_1 = require("../../messaging/sagas/OrderProcessingStateMachine");
const ProcessPaymentConsumer_1 = require("../../messaging/sagas/ProcessPaymentConsumer");
const ReserveInventoryConsumer_1 = require("../../messaging/sagas/ReserveInventoryConsumer");
const OrderRefundConsumer_1 = require("../../messaging/sagas/OrderRefundConsumer");
const OrderConfirmedConsumer_1 = require("../../messaging/sagas/OrderConfirmedConsumer");
const nestjs_bustransit_1 = require("nestjs-bustransit");
const configService = new config_1.ConfigService();
let MessagingInfrastructureModule = class MessagingInfrastructureModule {
};
exports.MessagingInfrastructureModule = MessagingInfrastructureModule;
exports.MessagingInfrastructureModule = MessagingInfrastructureModule = __decorate([
    (0, common_1.Global)(),
    (0, common_1.Module)({
        imports: [
            nestjs_bustransit_1.BusTransit.AddBusTransit.setUp((x) => {
                x.AddConsumer(SubmitOrderConsumer_1.SubmitOrderConsumer);
                x.AddConsumer(TestOrderConsumer_1.TestOrderConsumer);
                x.AddConsumer(ProcessPaymentConsumer_1.ProcessPaymentConsumer).Endpoint(e => {
                    e.Name = "saga-process-payment";
                });
                x.AddConsumer(ReserveInventoryConsumer_1.ReserveInventoryConsumer).Endpoint(e => {
                    e.Name = "saga-reserve-inventory";
                });
                x.AddConsumer(OrderConfirmedConsumer_1.OrderConfirmedConsumer).Endpoint(e => {
                    e.Name = "saga-order-confirmed";
                });
                x.AddConsumer(OrderRefundConsumer_1.OrderRefundConsumer).Endpoint(e => {
                    e.Name = "saga-order-refund";
                });
                x.AddSagaStateMachine(OrderProcessingStateMachine_1.OrderStateMachine, OrderProcessingStateMachine_1.OrderState);
                x.UsingRabbitMq(configService.get('APP_NAME'), (context, cfg) => {
                    cfg.PrefetchCount = 50;
                    cfg.Host(configService.get('RMQ_HOST'), configService.get('RMQ_VHOST'), (h) => {
                        h.Username(configService.get('RMQ_USERNAME'));
                        h.Password(configService.get('RMQ_PASSWORD'));
                    });
                    cfg.ReceiveEndpoint("regular-orders-1", e => {
                        e.PrefetchCount = 30;
                        e.ConfigureConsumer(SubmitOrderConsumer_1.SubmitOrderConsumer, context, c => {
                            c.UseMessageRetry(r => r.Immediate(5));
                        });
                    });
                    cfg.ReceiveEndpoint("regular-orders-2", e => {
                        e.ConfigureConsumer(TestOrderConsumer_1.TestOrderConsumer, context, c => {
                            c.UseDelayedRedelivery(r => r.Intervals(5000, 15000, 30000));
                        });
                    });
                    cfg.ReceiveEndpoint("regular-order-saga", e => {
                        e.ConfigureSaga(OrderProcessingStateMachine_1.OrderState, context, (c) => {
                        });
                    });
                    cfg.ReceiveEndpoint("saga-process-payment", e => {
                        e.ConfigureConsumer(ProcessPaymentConsumer_1.ProcessPaymentConsumer, context, c => {
                        });
                    });
                    cfg.ReceiveEndpoint("saga-reserve-inventory", e => {
                        e.ConfigureConsumer(ReserveInventoryConsumer_1.ReserveInventoryConsumer, context, c => {
                        });
                    });
                    cfg.ReceiveEndpoint("saga-order-confirmed", e => {
                        e.ConfigureConsumer(OrderConfirmedConsumer_1.OrderConfirmedConsumer, context, c => {
                        });
                    });
                    cfg.ReceiveEndpoint("saga-order-refund", e => {
                        e.ConfigureConsumer(OrderRefundConsumer_1.OrderRefundConsumer, context, c => {
                        });
                    });
                });
            })
        ],
        controllers: [],
        providers: [],
    })
], MessagingInfrastructureModule);
//# sourceMappingURL=messaging.module.js.map