import {
    DynamicModule,
    Module,
    OnApplicationShutdown,
    OnModuleDestroy,
    Global,
    Inject,
    Provider,
  } from '@nestjs/common';
  import { ModuleRef } from '@nestjs/core';
  import { IBusTransitModuleOptions } from './interfaces/bustransit-options.interface';
import { BUSTRANSIT_MODULE_OPTIONS } from './bustransit.constants';
import { BusTransitService } from './bustransit.service';
import { BusTransitModuleOptions_Factory } from './factories/bustransit-options';
import amqp from 'amqplib'
  
@Global()
@Module({
providers: [],
exports: [],
})
export class BusTransitCoreModule implements OnApplicationShutdown {

    constructor(
        @Inject(BUSTRANSIT_MODULE_OPTIONS) private readonly options: BusTransitModuleOptions_Factory,
        private readonly busTransitService: BusTransitService,
    ) {}

    static forRoot(options: any): DynamicModule {
        const busTransitModuleOptions: Provider = {
            provide: BUSTRANSIT_MODULE_OPTIONS,
            useValue: options,
        };

        return {
            module: BusTransitCoreModule,
            providers: [busTransitModuleOptions, BusTransitService],
            exports: [BusTransitService],
        };
    }

    async onApplicationShutdown() : Promise<void> {
        // this.busTransitService.close();
    }
}