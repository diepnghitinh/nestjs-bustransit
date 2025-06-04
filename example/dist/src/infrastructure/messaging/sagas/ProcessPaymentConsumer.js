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
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ProcessPaymentConsumer = void 0;
const common_1 = require("@nestjs/common");
const uuid_1 = require("uuid");
const message_1 = require("../../../../shared/messages/message");
const OrderProcessingStateMachine_1 = require("./OrderProcessingStateMachine");
const nestjs_bustransit_1 = require("nestjs-bustransit");
let ProcessPaymentConsumer = class ProcessPaymentConsumer extends nestjs_bustransit_1.BusTransitConsumer {
    constructor(publishEndpoint) {
        super(message_1.ProcessPayment);
        this.publishEndpoint = publishEndpoint;
    }
    async Consume(ctx, context) {
        await super.Consume(ctx, context);
        const randomRate = Math.random();
        if (randomRate > 0.2) {
            let paymentProcessed = new OrderProcessingStateMachine_1.PaymentProcessed();
            paymentProcessed.OrderId = context.Message.OrderId;
            paymentProcessed.PaymentIntentId = `T_${(0, uuid_1.v7)()}`;
            return await this.publishEndpoint.Send(paymentProcessed, ctx);
        }
        else {
            let orderFailed = new message_1.OrderFailed();
            orderFailed.OrderId = context.Message.OrderId;
            orderFailed.Reason = "Payment failed";
            return await this.publishEndpoint.Send(orderFailed, ctx);
        }
    }
};
exports.ProcessPaymentConsumer = ProcessPaymentConsumer;
exports.ProcessPaymentConsumer = ProcessPaymentConsumer = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, common_1.Inject)(nestjs_bustransit_1.IPublishEndpoint)),
    __metadata("design:paramtypes", [nestjs_bustransit_1.IPublishEndpoint])
], ProcessPaymentConsumer);
//# sourceMappingURL=ProcessPaymentConsumer.js.map