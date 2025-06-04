"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.OrderStateMachine = exports.InventoryReserved = exports.PaymentProcessed = exports.OrderSubmitted = exports.OrderState = void 0;
const common_1 = require("@nestjs/common");
const message_1 = require("../../../../shared/messages/message");
const nestjs_bustransit_1 = require("nestjs-bustransit");
class OrderState extends nestjs_bustransit_1.SagaStateMachineInstance {
}
exports.OrderState = OrderState;
class OrderSubmitted {
    constructor({ OrderId, Total, Email }) {
        this.OrderId = OrderId;
        this.Total = Total;
        this.Email = Email;
    }
}
exports.OrderSubmitted = OrderSubmitted;
class PaymentProcessed {
}
exports.PaymentProcessed = PaymentProcessed;
class InventoryReserved {
}
exports.InventoryReserved = InventoryReserved;
let OrderStateMachine = class OrderStateMachine extends nestjs_bustransit_1.BusTransitStateMachine {
    constructor() {
        super(OrderState);
        this.ProcessingPayment = new nestjs_bustransit_1.SagaState('ProcessingPayment');
        this.ReservingInventory = new nestjs_bustransit_1.SagaState('ReservingInventory');
        this.Completed = new nestjs_bustransit_1.SagaState('Completed');
        this.Failed = new nestjs_bustransit_1.SagaState('Failed');
        this.OrderSubmitted = new nestjs_bustransit_1.SagaEvent(OrderSubmitted);
        this.PaymentProcessed = new nestjs_bustransit_1.SagaEvent(PaymentProcessed);
        this.InventoryReserved = new nestjs_bustransit_1.SagaEvent(InventoryReserved);
        this.OrderFailed = new nestjs_bustransit_1.SagaEvent(message_1.OrderFailed);
        this.Event(this.OrderSubmitted, x => x.CorrelateById(m => m.Message.OrderId));
        this.Event(this.PaymentProcessed, x => x.CorrelateById(m => m.Message.OrderId));
        this.Event(this.InventoryReserved, x => x.CorrelateById(m => m.Message.OrderId));
        this.Event(this.OrderFailed, x => x.CorrelateById(m => m.Message.OrderId));
        this.Initially(this.When(OrderSubmitted).Then(c => {
            c.Saga.OrderTotal = c.Message.Total;
            c.Saga.CustomerEmail = c.Message.Email;
            c.Saga.OrderDate = new Date();
        })
            .PublishAsync(message_1.ProcessPayment, c => {
            let processPayment = new message_1.ProcessPayment();
            processPayment.OrderId = c.Saga.CorrelationId;
            processPayment.Amount = c.Saga.OrderTotal;
            return processPayment;
        })
            .TransitionTo(this.ProcessingPayment));
        this.During(this.ProcessingPayment, [
            this.When(PaymentProcessed)
                .Then(c => {
                c.Saga.PaymentIntentId = c.Message.PaymentIntentId;
            })
                .PublishAsync(message_1.ReserveInventory, c => {
                let reserveInventory = new message_1.ReserveInventory();
                reserveInventory.OrderId = c.Saga.CorrelationId;
                return reserveInventory;
            })
                .TransitionTo(this.ReservingInventory),
            this.When(message_1.OrderFailed).TransitionTo(this.Failed).Finalize()
        ]);
        this.During(this.ReservingInventory, [
            this.When(InventoryReserved)
                .PublishAsync(message_1.OrderConfirmed, c => {
                let orderConfirmed = new message_1.OrderConfirmed();
                orderConfirmed.OrderId = c.Saga.CorrelationId;
                return orderConfirmed;
            }).TransitionTo(this.Completed).Finalize(),
            this.When(message_1.OrderFailed)
                .PublishAsync(message_1.RefundPayment, c => {
                let refundPayment = new message_1.RefundPayment();
                refundPayment.OrderId = c.Saga.CorrelationId;
                refundPayment.Amount = c.Saga.OrderTotal;
                return refundPayment;
            }).TransitionTo(this.Failed).Finalize(),
        ]);
        this.SetCompletedWhenFinalized(c => {
            console.log('Result saga');
            console.log(c.Saga);
        });
    }
};
exports.OrderStateMachine = OrderStateMachine;
exports.OrderStateMachine = OrderStateMachine = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [])
], OrderStateMachine);
//# sourceMappingURL=OrderProcessingStateMachine.js.map