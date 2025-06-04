import {
    DynamicModule,
    Module,
    OnApplicationShutdown,
    OnModuleDestroy,
    Global,
    Inject,
    Provider, Logger, OnApplicationBootstrap, ParamData,
} from '@nestjs/common';
import {
    BUSTRANSIT_CONSUMERS,
    BUSTRANSIT_CONSUMERS_BIND_QUEUE,
    BUSTRANSIT_MODULE_OPTIONS,
} from './bustransit.constants';
import { BusTransitModuleOptions_Factory } from './factories/bustransit-options';
import {BusTransitService} from "./bustransit.service";
import {IPublishEndpoint} from "./interfaces/publish-endpoint.interface";
import {PublishEndpoint} from "./factories/publish-endpoint";
import { ExternalContextCreator } from '@nestjs/core/helpers/external-context-creator';

@Global()
@Module({
    providers: [
        BusTransitService
    ],
    exports: [
        BusTransitService
    ],
})
export class BusTransitCoreModule implements OnApplicationShutdown {

    constructor(
        @Inject(BUSTRANSIT_MODULE_OPTIONS) private readonly options: BusTransitModuleOptions_Factory,
        private readonly externalContextCreator: ExternalContextCreator,
        private readonly busTransitService: BusTransitService,
    ) {}

    static forRoot(options: any, consumers, consumersBindQueue): DynamicModule {

        const busTransitModuleOptions: Provider = {
            provide: BUSTRANSIT_MODULE_OPTIONS,
            useValue: options,
        };

        const busTransitConsumers: Provider = {
            provide: BUSTRANSIT_CONSUMERS,
            useValue: consumers,
        };

        const busTransitConsumersBindQueue: Provider = {
            provide: BUSTRANSIT_CONSUMERS_BIND_QUEUE,
            useValue: consumersBindQueue,
        };

        const producerPublishEndpoint: Provider = {
            provide: IPublishEndpoint, useClass: PublishEndpoint,
        };

        const _consumersProvider = Object.entries(consumers).map((key, value) => {
            return {
                provide: consumers[key[0]], useClass: consumers[key[0]]
            } as Provider;
        });

        return {
            module: BusTransitCoreModule,
            providers: [
                ..._consumersProvider,
                busTransitModuleOptions, busTransitConsumers, busTransitConsumersBindQueue,
                producerPublishEndpoint,
                BusTransitService,
            ],
            exports: [
                ..._consumersProvider,
                producerPublishEndpoint,
                BusTransitService,
            ],
        };
    }

    async onApplicationShutdown() : Promise<void> {
        this.busTransitService.close();
    }
}