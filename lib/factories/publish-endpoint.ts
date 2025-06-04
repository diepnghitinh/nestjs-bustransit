import {IPublishEndpoint} from "../interfaces/publish-endpoint.interface";
import {Inject, Injectable, Logger} from "@nestjs/common";
import {BusTransitBrokerBaseFactory} from "./brokers/bustransit-broker.base";
import {BehaviorContext} from "./behavior.context";
import {BusTransitService} from "../bustransit.service";

@Injectable()
export class PublishEndpoint implements IPublishEndpoint {

    private broker: BusTransitBrokerBaseFactory;

    constructor(
        @Inject()
        private busTransitService: BusTransitService
    ) {
        this.broker = this.busTransitService.getBroker();
    }

    async Publish<T>(message: T, ctx?: BehaviorContext<any, T>) {
        await this.broker.publish<T>(message, ctx)
    }

    async Send<T>(message: T, ctx?: BehaviorContext<any, T>): Promise<any> {
        return await this.broker.publishAsync<T>(message, ctx)
    }
}