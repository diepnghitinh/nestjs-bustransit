/**
 * Routing Slip Service
 * High-level service for executing routing slips with automatic executor management
 */

import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { RoutingSlipExecutor } from '../factories/routing-slip.executor';
import { RoutingSlipDistributedExecutor } from '../factories/routing-slip.distributed-executor';
import { IActivityFactory } from '../interfaces/activity.interface';
import { IRoutingSlip } from '../interfaces/routing-slip.interface';
import { IRoutingSlipEventSubscriber } from '../interfaces/routing-slip.events';
import { RoutingSlipBuilder } from '../factories/routing-slip.builder';
import { RoutingSlipModuleOptions } from '../routing-slip.module';
import {
    ACTIVITY_FACTORY,
    ROUTING_SLIP_MODULE_OPTIONS,
    RoutingSlipExecutionMode
} from '../constants/routing-slip.constants';
import { RoutingSlipQueueProvisioningService } from './routing-slip-queue-provisioning.service';
import { IPublishEndpoint } from '../interfaces/publish-endpoint.interface';

/**
 * Service for executing routing slips with automatic configuration
 */
@Injectable()
export class RoutingSlipService {
    private readonly logger = new Logger(RoutingSlipService.name);
    private executor: any; // RoutingSlipExecutor | RoutingSlipDistributedExecutor
    private eventSubscribers: IRoutingSlipEventSubscriber[] = [];

    constructor(
        @Inject(ACTIVITY_FACTORY)
        private readonly activityFactory: IActivityFactory,
        @Optional()
        private readonly queueProvisioning?: RoutingSlipQueueProvisioningService,
        @Optional()
        private readonly publishEndpoint?: IPublishEndpoint,
        @Optional()
        @Inject(ROUTING_SLIP_MODULE_OPTIONS)
        private readonly options?: RoutingSlipModuleOptions
    ) {
        // Choose executor based on execution mode
        const executionMode = this.options?.executionMode || RoutingSlipExecutionMode.InProcess;

        if (executionMode === RoutingSlipExecutionMode.Distributed) {
            if (!this.publishEndpoint || !this.queueProvisioning) {
                this.logger.warn('Distributed mode requires publishEndpoint and queueProvisioning. Falling back to InProcess mode.');
                this.executor = new RoutingSlipExecutor(this.activityFactory);
            } else {
                this.logger.log('RoutingSlipService initialized in DISTRIBUTED mode');
                this.executor = new RoutingSlipDistributedExecutor(
                    this.activityFactory,
                    this.publishEndpoint,
                    this.queueProvisioning
                );
            }
        } else {
            this.logger.log('RoutingSlipService initialized in IN-PROCESS mode');
            this.executor = new RoutingSlipExecutor(this.activityFactory);
        }
    }

    /**
     * Execute a routing slip
     *
     * @example
     * ```typescript
     * const routingSlip = RoutingSlipBuilder.create()
     *   .addActivity('ProcessPayment', 'payment-service', args)
     *   .addActivity('ReserveInventory', 'inventory-service', args)
     *   .build();
     *
     * await this.routingSlipService.execute(routingSlip);
     * ```
     */
    async execute(routingSlip: IRoutingSlip): Promise<void> {
        this.logger.log(`Executing routing slip: ${routingSlip.trackingNumber}`);
        await this.executor.execute(routingSlip);
    }

    /**
     * Create a new routing slip builder
     *
     * @example
     * ```typescript
     * const routingSlip = this.routingSlipService
     *   .createBuilder()
     *   .addActivity('ProcessPayment', 'payment-service', args)
     *   .build();
     * ```
     */
    createBuilder(trackingNumber?: string): RoutingSlipBuilder {
        return RoutingSlipBuilder.create(trackingNumber);
    }

    /**
     * Subscribe to routing slip events
     *
     * @example
     * ```typescript
     * this.routingSlipService.subscribe({
     *   async onCompleted(event) {
     *     console.log('Routing slip completed:', event.trackingNumber);
     *   }
     * });
     * ```
     */
    subscribe(subscriber: IRoutingSlipEventSubscriber): void {
        this.eventSubscribers.push(subscriber);
        this.executor.subscribe(subscriber);
        this.logger.log('Event subscriber registered');
    }

    /**
     * Unsubscribe from routing slip events
     */
    unsubscribe(subscriber: IRoutingSlipEventSubscriber): void {
        const index = this.eventSubscribers.indexOf(subscriber);
        if (index > -1) {
            this.eventSubscribers.splice(index, 1);
            this.logger.log('Event subscriber removed');
        }
    }

    /**
     * Get module configuration options
     */
    getOptions(): RoutingSlipModuleOptions | undefined {
        return this.options;
    }

    /**
     * Get the underlying executor
     */
    getExecutor(): RoutingSlipExecutor {
        return this.executor;
    }
}
