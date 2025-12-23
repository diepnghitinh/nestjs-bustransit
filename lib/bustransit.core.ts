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
    BUSTRANSIT_CONSUMERS_BIND_QUEUE, BUSTRANSIT_MESSSAGES_BIND_QUEUE,
    BUSTRANSIT_MODULE_OPTIONS,
} from './bustransit.constants';
import { SAGA_REPOSITORY, SAGA_PERSISTENCE_OPTIONS } from './constants/saga-persistence.constants';
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
export class BusTransitCoreModule implements OnApplicationBootstrap, OnApplicationShutdown {

    constructor(
        @Inject(BUSTRANSIT_MODULE_OPTIONS) private readonly options: BusTransitModuleOptions_Factory,
        private readonly externalContextCreator: ExternalContextCreator,
        private readonly busTransitService: BusTransitService,
    ) {}

    static forRoot(options: any, consumers, consumersBindQueue, messagesBindQueue): DynamicModule {

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

        const busTransitMessagesBindQueue: Provider = {
            provide: BUSTRANSIT_MESSSAGES_BIND_QUEUE,
            useValue: messagesBindQueue,
        };

        const producerPublishEndpoint: Provider = {
            provide: IPublishEndpoint, useClass: PublishEndpoint,
        };

        const _consumersProvider = Object.entries(consumers).map((key, value) => {
            const consumerData = consumers[key[0]];

            // Check if this is a saga state machine (has machineClass and stateClass)
            if (consumerData && typeof consumerData === 'object' && 'machineClass' in consumerData && 'stateClass' in consumerData) {
                const { machineClass, stateClass } = consumerData as any;

                // Use factory provider for saga state machines to inject dependencies
                return {
                    provide: machineClass,
                    useFactory: (repository?: any, options?: any) => {
                        return new machineClass(stateClass, repository, options);
                    },
                    inject: [
                        { token: SAGA_REPOSITORY, optional: true },
                        { token: SAGA_PERSISTENCE_OPTIONS, optional: true }
                    ]
                } as Provider;
            }

            // Regular consumers use class provider
            return {
                provide: consumerData,
                useClass: consumerData
            } as Provider;
        });

        return {
            module: BusTransitCoreModule,
            providers: [
                ..._consumersProvider,
                busTransitModuleOptions, busTransitConsumers, busTransitConsumersBindQueue,
                busTransitMessagesBindQueue,
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

    onApplicationBootstrap(): any {
        this.busTransitService.startBroker();
    }
}