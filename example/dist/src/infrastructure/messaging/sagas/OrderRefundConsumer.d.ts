import { RefundPayment } from "@shared/messages/message";
import { BusTransitConsumer, IPublishEndpoint, ISagaConsumeContext } from "nestjs-bustransit";
export declare class OrderRefundConsumer extends BusTransitConsumer<RefundPayment> {
    private readonly publishEndpoint;
    constructor(publishEndpoint: IPublishEndpoint);
    Consume(ctx: any, context: ISagaConsumeContext<any, RefundPayment>): Promise<any>;
}
