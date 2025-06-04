import { ReserveInventory } from "@shared/messages/message";
import { BusTransitConsumer, IPublishEndpoint, ISagaConsumeContext } from "nestjs-bustransit";
export declare class ReserveInventoryConsumer extends BusTransitConsumer<ReserveInventory> {
    private readonly publishEndpoint;
    constructor(publishEndpoint: IPublishEndpoint);
    Consume(ctx: any, context: ISagaConsumeContext<any, ReserveInventory>): Promise<any>;
}
