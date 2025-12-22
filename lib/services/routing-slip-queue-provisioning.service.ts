/**
 * Routing Slip Queue Provisioning Service
 * Automatically provisions execute and compensate queues for routing slip activities
 */

import { Injectable, Logger, OnModuleInit, Inject, Optional } from '@nestjs/common';
import { RoutingSlipActivityFactory } from '../factories/routing-slip-activity.factory';
import { RoutingSlipModuleOptions } from '../routing-slip.module';
import { ROUTING_SLIP_MODULE_OPTIONS } from '../constants/routing-slip.constants';
import { IActivity, IExecuteActivity } from '../interfaces/activity.interface';
import { ActivityExecuteConsumerFactory } from '../routing-slips/consumers/activity-execute.consumer';
import { ActivityCompensateConsumerFactory } from '../routing-slips/consumers/activity-compensate.consumer';

/**
 * Queue configuration for an activity
 */
export interface IActivityQueueConfiguration {
    activityName: string;
    executeQueueName: string;
    compensateQueueName?: string;
    hasCompensation: boolean;
}

/**
 * Service that provisions queues for routing slip activities
 */
@Injectable()
export class RoutingSlipQueueProvisioningService implements OnModuleInit {
    private readonly logger = new Logger(RoutingSlipQueueProvisioningService.name);
    private queueConfigurations: Map<string, IActivityQueueConfiguration> = new Map();

    constructor(
        private readonly activityFactory: RoutingSlipActivityFactory,
        @Optional()
        @Inject(ROUTING_SLIP_MODULE_OPTIONS)
        private readonly options?: RoutingSlipModuleOptions
    ) {}

    /**
     * Provision queues on module initialization
     */
    async onModuleInit() {
        if (!this.options?.autoProvisionQueues) {
            this.logger.log('Auto-provisioning is disabled');
            return;
        }

        await this.provisionQueues();
    }

    /**
     * Provision queues for all discovered activities
     */
    async provisionQueues(): Promise<void> {
        this.logger.log('Provisioning queues for routing slip activities...');

        const activityNames = this.activityFactory.getActivityNames();

        for (const activityName of activityNames) {
            try {
                const activity = this.activityFactory.createActivity(activityName);
                const metadata = this.activityFactory.getActivityMetadata(activityName);

                // Determine queue names
                const queuePrefix = this.options?.queuePrefix || '';
                const baseQueueName = metadata?.queueAddress || this.normalizeActivityName(activityName);

                const executeQueueName = this.buildQueueName(queuePrefix, baseQueueName, 'execute');
                const compensateQueueName = this.isCompensatableActivity(activity)
                    ? this.buildQueueName(queuePrefix, baseQueueName, 'compensate')
                    : undefined;

                // Store queue configuration
                const config: IActivityQueueConfiguration = {
                    activityName,
                    executeQueueName,
                    compensateQueueName,
                    hasCompensation: !!compensateQueueName
                };

                this.queueConfigurations.set(activityName, config);

                this.logger.log(`Configured queues for ${activityName}:`);
                this.logger.log(`  - Execute: ${executeQueueName}`);
                if (compensateQueueName) {
                    this.logger.log(`  - Compensate: ${compensateQueueName}`);
                }

            } catch (error) {
                this.logger.error(`Failed to provision queues for ${activityName}: ${error.message}`);
            }
        }

        this.logger.log(`Queue provisioning completed for ${this.queueConfigurations.size} activities`);
    }

    /**
     * Get queue configuration for an activity
     */
    getQueueConfiguration(activityName: string): IActivityQueueConfiguration | undefined {
        return this.queueConfigurations.get(activityName);
    }

    /**
     * Get all queue configurations
     */
    getAllQueueConfigurations(): IActivityQueueConfiguration[] {
        return Array.from(this.queueConfigurations.values());
    }

    /**
     * Build queue name with prefix and suffix
     */
    private buildQueueName(prefix: string, baseName: string, suffix: string): string {
        const parts: string[] = [];

        if (prefix) {
            parts.push(prefix);
        }

        parts.push(baseName);
        parts.push(suffix);

        return parts.join('_');
    }

    /**
     * Normalize activity name to queue-friendly format
     * ProcessPayment -> process-payment
     */
    private normalizeActivityName(activityName: string): string {
        return activityName
            .replace(/([A-Z])/g, '-$1')
            .toLowerCase()
            .replace(/^-/, '');
    }

    /**
     * Check if activity supports compensation
     */
    private isCompensatableActivity<TArguments, TLog>(
        activity: IActivity<TArguments, TLog> | IExecuteActivity<TArguments>
    ): activity is IActivity<TArguments, TLog> {
        return 'compensate' in activity && typeof activity.compensate === 'function';
    }

    /**
     * Create execute consumer for an activity
     */
    createExecuteConsumer(activityName: string): any | null {
        try {
            const activity = this.activityFactory.createActivity(activityName);
            return ActivityExecuteConsumerFactory.createConsumer(activityName, activity);
        } catch (error) {
            this.logger.error(`Failed to create execute consumer for ${activityName}: ${error.message}`);
            return null;
        }
    }

    /**
     * Create compensate consumer for an activity
     */
    createCompensateConsumer(activityName: string): any | null {
        try {
            const activity = this.activityFactory.createActivity(activityName);

            if (this.isCompensatableActivity(activity)) {
                return ActivityCompensateConsumerFactory.createConsumer(activityName, activity);
            } else {
                this.logger.warn(`Activity ${activityName} does not support compensation`);
                return null;
            }
        } catch (error) {
            this.logger.error(`Failed to create compensate consumer for ${activityName}: ${error.message}`);
            return null;
        }
    }
}
