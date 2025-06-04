import { BusTransitConsumer, IPublishEndpoint } from "nestjs-bustransit";
declare class Message2 {
    Text: string;
}
export declare class TestOrderConsumer extends BusTransitConsumer<Message2> {
    private readonly publishEndpoint;
    constructor(publishEndpoint: IPublishEndpoint);
    Consume(ctx: any, context: any): Promise<void>;
}
export {};
