import { BusTransitConsumer } from "nestjs-bustransit";
import { IPublishEndpoint } from "nestjs-bustransit";
export declare class OrderMessage {
    Text: string;
}
export declare class SubmitOrderConsumer extends BusTransitConsumer<OrderMessage> {
    private readonly publishEndpoint;
    constructor(publishEndpoint: IPublishEndpoint);
    Consume(ctx: any, context: any): Promise<void>;
}
