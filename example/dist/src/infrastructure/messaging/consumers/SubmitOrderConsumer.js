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
exports.SubmitOrderConsumer = exports.OrderMessage = void 0;
const common_1 = require("@nestjs/common");
const class_validator_1 = require("@nestjs/class-validator");
const nestjs_bustransit_1 = require("nestjs-bustransit");
const nestjs_bustransit_2 = require("nestjs-bustransit");
class OrderMessage {
}
exports.OrderMessage = OrderMessage;
__decorate([
    (0, class_validator_1.IsNotEmpty)(),
    __metadata("design:type", String)
], OrderMessage.prototype, "Text", void 0);
class SubmitOrderConsumerDefinition {
}
let SubmitOrderConsumer = class SubmitOrderConsumer extends nestjs_bustransit_1.BusTransitConsumer {
    constructor(publishEndpoint) {
        super(OrderMessage);
        this.publishEndpoint = publishEndpoint;
    }
    async Consume(ctx, context) {
        await super.Consume(ctx, context);
        common_1.Logger.debug('SubmitOrderConsumer receive');
        console.log(context.Message);
    }
};
exports.SubmitOrderConsumer = SubmitOrderConsumer;
exports.SubmitOrderConsumer = SubmitOrderConsumer = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, common_1.Inject)(nestjs_bustransit_2.IPublishEndpoint)),
    __metadata("design:paramtypes", [nestjs_bustransit_2.IPublishEndpoint])
], SubmitOrderConsumer);
//# sourceMappingURL=SubmitOrderConsumer.js.map