/**
 * Automatic Routing Slip Activity Factory
 * Discovers and registers activities marked with @RoutingSlipActivity decorator
 */

import { Injectable, Logger, OnModuleInit, Type } from '@nestjs/common';
import { DiscoveryService, MetadataScanner, Reflector } from '@nestjs/core';
import { InstanceWrapper } from '@nestjs/core/injector/instance-wrapper';
import { IActivityFactory, IActivity, IExecuteActivity } from '../interfaces/activity.interface';
import { ROUTING_SLIP_ACTIVITY_METADATA, RoutingSlipActivityOptions } from '../decorators/routing-slip-activity.decorator';

/**
 * Automatic activity factory that discovers activities using reflection
 */
@Injectable()
export class RoutingSlipActivityFactory implements IActivityFactory, OnModuleInit {
    private readonly logger = new Logger(RoutingSlipActivityFactory.name);
    private readonly activities = new Map<string, any>();
    private readonly activityMetadata = new Map<string, RoutingSlipActivityOptions>();

    constructor(
        private readonly discoveryService: DiscoveryService,
        private readonly reflector: Reflector
    ) {}

    /**
     * Discover and register all activities on module initialization
     */
    async onModuleInit() {
        await this.discoverActivities();
    }

    /**
     * Create an activity instance by name
     */
    createActivity<TArguments, TLog>(activityName: string): IActivity<TArguments, TLog> | IExecuteActivity<TArguments> {
        const activity = this.activities.get(activityName);

        if (!activity) {
            this.logger.warn(`Activity not found: ${activityName}`);
            this.logger.warn(`Available activities: ${Array.from(this.activities.keys()).join(', ')}`);
            throw new Error(`Activity not found: ${activityName}`);
        }

        return activity;
    }

    /**
     * Get activity metadata
     */
    getActivityMetadata(activityName: string): RoutingSlipActivityOptions | undefined {
        return this.activityMetadata.get(activityName);
    }

    /**
     * Get all registered activity names
     */
    getActivityNames(): string[] {
        return Array.from(this.activities.keys());
    }

    /**
     * Manually register an activity
     */
    registerActivity(activityName: string, activity: any, metadata?: RoutingSlipActivityOptions): void {
        this.activities.set(activityName, activity);
        if (metadata) {
            this.activityMetadata.set(activityName, metadata);
        }
        this.logger.log(`Registered activity: ${activityName}`);
    }

    /**
     * Discover activities using NestJS discovery service
     */
    private async discoverActivities(): Promise<void> {
        this.logger.log('Discovering routing slip activities...');

        const providers = this.discoveryService.getProviders();
        const activityProviders = providers.filter(wrapper =>
            this.isActivityProvider(wrapper)
        );

        for (const wrapper of activityProviders) {
            try {
                const { instance, metatype } = wrapper;

                if (!instance || !metatype) {
                    continue;
                }

                const metadata = this.reflector.get<RoutingSlipActivityOptions>(
                    ROUTING_SLIP_ACTIVITY_METADATA,
                    metatype
                );

                if (metadata) {
                    const activityName = metadata.name || metatype.name;
                    this.registerActivity(activityName, instance, metadata);
                }
            } catch (error) {
                this.logger.error(`Error registering activity: ${error.message}`, error.stack);
            }
        }

        this.logger.log(`Discovered ${this.activities.size} routing slip activities`);
        if (this.activities.size > 0) {
            this.logger.log(`Registered activities: ${this.getActivityNames().join(', ')}`);
        }
    }

    /**
     * Check if a provider is a routing slip activity
     */
    private isActivityProvider(wrapper: InstanceWrapper): boolean {
        const { metatype } = wrapper;

        if (!metatype) {
            return false;
        }

        const metadata = this.reflector.get<RoutingSlipActivityOptions>(
            ROUTING_SLIP_ACTIVITY_METADATA,
            metatype
        );

        return !!metadata;
    }
}
