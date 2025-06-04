import { ProcessPayment } from "@shared/messages/message";
import { BusTransitConsumer, IPublishEndpoint, ISagaConsumeContext } from "nestjs-bustransit";
export declare class ProcessPaymentConsumer extends BusTransitConsumer<ProcessPayment> {
    private readonly publishEndpoint;
    constructor(publishEndpoint: IPublishEndpoint);
    Consume(ctx: any, context: ISagaConsumeContext<any, ProcessPayment>): Promise<any>;
}
