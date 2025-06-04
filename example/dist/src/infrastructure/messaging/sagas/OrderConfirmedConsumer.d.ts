import { OrderConfirmed } from "@shared/messages/message";
import { BusTransitConsumer, IPublishEndpoint, ISagaConsumeContext } from "nestjs-bustransit";
export declare class OrderConfirmedConsumer extends BusTransitConsumer<OrderConfirmed> {
    private readonly publishEndpoint;
    constructor(publishEndpoint: IPublishEndpoint);
    Consume(ctx: any, context: ISagaConsumeContext<any, OrderConfirmed>): Promise<any>;
}
