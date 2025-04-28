import {IPublishEndpoint} from "@core/bustransit/interfaces/publish-endpoint.interface";
import {Inject, Injectable, Logger} from "@nestjs/common";
import {BusTransitService} from "@core/bustransit/bustransit.service";
import {BusTransitBrokerBaseFactory} from "@core/bustransit/factories/brokers/bustransit-broker.base";
import {BehaviorContext} from "@core/bustransit/factories/behavior.context";
import {IConsumeContext} from "@core/bustransit/interfaces/consumer.interface";

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