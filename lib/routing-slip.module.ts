/**
 * Routing Slip Module
 * Provides automatic activity registration and configuration
 */

import { DynamicModule, Module, Provider, Type } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';
import { RoutingSlipActivityFactory } from './factories/routing-slip-activity.factory';
import { RoutingSlipService } from './services/routing-slip.service';
import { RoutingSlipQueueProvisioningService } from './services/routing-slip-queue-provisioning.service';
import { IActivityFactory } from './interfaces/activity.interface';
import {
    ACTIVITY_FACTORY,
    ROUTING_SLIP_MODULE_OPTIONS,
    RoutingSlipExecutionMode
} from './constants/routing-slip.constants';
import { RoutingSlipModeRegistry } from './routing-slips/helpers/routing-slip-mode-detector';

/**
 * Configuration options for the Routing Slip module
 */
export interface RoutingSlipModuleOptions {
    /**
     * Execution mode (InProcess or Distributed)
     * @default RoutingSlipExecutionMode.InProcess
     */
    executionMode?: RoutingSlipExecutionMode;

    /**
     * Global queue prefix for distributed mode
     * @example 'myapp' -> 'myapp-process-payment_execute'
     */
    queuePrefix?: string;

    /**
     * Enable automatic queue provisioning in distributed mode
     * @default true
     */
    autoProvisionQueues?: boolean;

    /**
     * Custom activity factory (optional)
     * If not provided, automatic factory will be used
     */
    activityFactory?: Type<IActivityFactory>;

    /**
     * Enable event subscriber registration
     * @default true
     */
    enableEventSubscribers?: boolean;
}

/**
 * Async options for module configuration
 */
export interface RoutingSlipModuleAsyncOptions {
    useFactory?: (...args: any[]) => Promise<RoutingSlipModuleOptions> | RoutingSlipModuleOptions;
    inject?: any[];
}

@Module({})
export class RoutingSlipModule {
    /**
     * Configure routing slip module with options
     *
     * @example
     * ```typescript
     * @Module({
     *   imports: [
     *     RoutingSlipModule.forRoot({
     *       executionMode: RoutingSlipExecutionMode.InProcess,
     *       enableEventSubscribers: true
     *     })
     *   ]
     * })
     * export class AppModule {}
     * ```
     */
    static forRoot(options: RoutingSlipModuleOptions = {}): DynamicModule {
        // Read execution mode from registry (set in routing-slip.config.ts)
        // This ensures single source of truth
        const executionMode = RoutingSlipModeRegistry.getMode();
        const queuePrefix = options.queuePrefix || RoutingSlipModeRegistry.getQueuePrefix();

        const moduleOptions = {
            executionMode,
            queuePrefix,
            autoProvisionQueues: true,
            enableEventSubscribers: true,
            ...options
        };

        const providers: Provider[] = [
            {
                provide: ROUTING_SLIP_MODULE_OPTIONS,
                useValue: moduleOptions
            },
            {
                provide: ACTIVITY_FACTORY,
                useClass: options.activityFactory || RoutingSlipActivityFactory
            },
            RoutingSlipActivityFactory,
            RoutingSlipQueueProvisioningService,
            RoutingSlipService
        ];

        return {
            module: RoutingSlipModule,
            imports: [DiscoveryModule],
            providers,
            exports: [
                RoutingSlipService,
                RoutingSlipQueueProvisioningService,
                ACTIVITY_FACTORY,
                ROUTING_SLIP_MODULE_OPTIONS
            ],
            global: false
        };
    }

    /**
     * Configure routing slip module asynchronously
     *
     * @example
     * ```typescript
     * @Module({
     *   imports: [
     *     RoutingSlipModule.forRootAsync({
     *       useFactory: (configService: ConfigService) => ({
     *         executionMode: configService.get('ROUTING_SLIP_MODE'),
     *         queuePrefix: configService.get('QUEUE_PREFIX')
     *       }),
     *       inject: [ConfigService]
     *     })
     *   ]
     * })
     * export class AppModule {}
     * ```
     */
    static forRootAsync(options: RoutingSlipModuleAsyncOptions): DynamicModule {
        const providers: Provider[] = [
            {
                provide: ROUTING_SLIP_MODULE_OPTIONS,
                useFactory: options.useFactory,
                inject: options.inject || []
            },
            {
                provide: ACTIVITY_FACTORY,
                useClass: RoutingSlipActivityFactory
            },
            RoutingSlipActivityFactory,
            RoutingSlipQueueProvisioningService,
            RoutingSlipService
        ];

        return {
            module: RoutingSlipModule,
            imports: [DiscoveryModule],
            providers,
            exports: [
                RoutingSlipService,
                RoutingSlipQueueProvisioningService,
                ACTIVITY_FACTORY,
                ROUTING_SLIP_MODULE_OPTIONS
            ],
            global: false
        };
    }

    /**
     * Register activities for a feature module
     *
     * @example
     * ```typescript
     * @Module({
     *   imports: [
     *     RoutingSlipModule.forFeature([
     *       ProcessPaymentActivity,
     *       ReserveInventoryActivity
     *     ])
     *   ]
     * })
     * export class OrderModule {}
     * ```
     */
    static forFeature(activities: Type<any>[]): DynamicModule {
        const providers: Provider[] = [
            ...activities,
            RoutingSlipService
        ];

        return {
            module: RoutingSlipModule,
            providers,
            exports: [RoutingSlipService]
        };
    }
}
