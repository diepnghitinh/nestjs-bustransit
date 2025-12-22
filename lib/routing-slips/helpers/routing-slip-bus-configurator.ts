/**
 * Routing Slip BusTransit Configurator
 * Helper to automatically register routing slip activity consumers with BusTransit
 */

import { Type, Logger } from '@nestjs/common';
import { RoutingSlipActivityFactory } from '../../factories/routing-slip-activity.factory';
import { ActivityExecuteConsumerFactory } from '../consumers/activity-execute.consumer';
import { ActivityCompensateConsumerFactory } from '../consumers/activity-compensate.consumer';
import { IActivity, IExecuteActivity } from '../../interfaces/activity.interface';
import { RoutingSlipModeRegistry } from './routing-slip-mode-detector';

/**
 * Configuration for routing slip activities in BusTransit
 */
export interface IRoutingSlipBusConfiguration {
    /**
     * Queue prefix for all activities
     */
    queuePrefix?: string;

    /**
     * Activity factory instance (will be injected at runtime)
     */
    activityFactory?: RoutingSlipActivityFactory;

    /**
     * Activities to register (class references)
     */
    activities: Type<any>[];
}

/**
 * Helper class to configure routing slip activities with BusTransit
 */
export class RoutingSlipBusConfigurator {
    private static consumerRegistry: Map<string, { execute: any; compensate?: any }> = new Map();

    /**
     * Configure routing slip activities for BusTransit
     * Call this in your BusTransit.AddBusTransit.setUp() configuration
     *
     * @example
     * ```typescript
     * import { RoutingSlipBusConfigurator } from 'nestjs-bustransit';
     *
     * BusTransit.AddBusTransit.setUp((x) => {
     *     // Configure routing slip activities
     *     RoutingSlipBusConfigurator.configure(x, {
     *         queuePrefix: 'myapp',
     *         activities: [
     *             ProcessPaymentActivity,
     *             ReserveInventoryActivity,
     *             SendConfirmationActivity
     *         ]
     *     });
     *
     *     // Configure RabbitMQ
     *     x.UsingRabbitMq('myapp', (context, cfg) => {
     *         cfg.Host(...);
     *
     *         // Set up routing slip activity endpoints
     *         RoutingSlipBusConfigurator.configureEndpoints(cfg, context, {
     *             queuePrefix: 'myapp',
     *             activities: [
     *                 ProcessPaymentActivity,
     *                 ReserveInventoryActivity,
     *                 SendConfirmationActivity
     *             ]
     *         });
     *     });
     * });
     * ```
     */
    static configure(busTransit: any, config: IRoutingSlipBusConfiguration): void {
        const logger = new Logger('RoutingSlipBusConfigurator');

        // Check if we're in Distributed mode
        if (!RoutingSlipModeRegistry.isDistributedMode()) {
            logger.log('InProcess mode detected - skipping consumer registration');
            logger.log('Consumers are only registered in Distributed mode');
            return;
        }

        logger.log('Distributed mode detected - registering activity consumers...');

        const { activities, activityFactory } = config;
        const queuePrefix = config.queuePrefix || RoutingSlipModeRegistry.getQueuePrefix() || '';

        // Note: Activity instances will be retrieved from DI container at runtime
        // We create placeholder instances here just to check if they support compensation
        activities.forEach((activityClass) => {
            const activityName = activityClass.name;
            const tempInstance = Object.create(activityClass.prototype);

            // Create execute consumer (will use ActivityFactory at runtime)
            const ExecuteConsumer = ActivityExecuteConsumerFactory.createConsumer(
                activityName,
                tempInstance as any
            );

            // Register execute consumer
            busTransit.AddConsumer(ExecuteConsumer);
            logger.log(`  ✓ Registered execute consumer: ${activityName}`);

            // Store for later endpoint configuration
            const consumers: any = { execute: ExecuteConsumer };

            // Create and register compensate consumer if activity supports compensation
            if (this.isCompensatableActivity(tempInstance)) {
                const CompensateConsumer = ActivityCompensateConsumerFactory.createConsumer(
                    activityName,
                    tempInstance
                );

                // Register compensate consumer
                busTransit.AddConsumer(CompensateConsumer);
                logger.log(`  ✓ Registered compensate consumer: ${activityName}`);
                consumers.compensate = CompensateConsumer;
            }

            this.consumerRegistry.set(activityName, consumers);
        });

        logger.log(`Consumer registration complete - ${activities.length} activities configured`);
    }

    /**
     * Configure RabbitMQ endpoints for routing slip activities
     * Call this inside your UsingRabbitMq configuration
     */
    static configureEndpoints(rabbitmqConfig: any, context: any, config: IRoutingSlipBusConfiguration): void {
        const logger = new Logger('RoutingSlipBusConfigurator');

        // Check if we're in Distributed mode
        if (!RoutingSlipModeRegistry.isDistributedMode()) {
            logger.log('InProcess mode detected - skipping endpoint configuration');
            return;
        }

        logger.log('Distributed mode detected - configuring RabbitMQ endpoints...');

        const queuePrefix = config.queuePrefix || RoutingSlipModeRegistry.getQueuePrefix() || '';
        const { activities } = config;

        activities.forEach((activityClass) => {
            const activityName = activityClass.name;
            const normalizedName = this.normalizeActivityName(activityName);

            // Configure execute endpoint
            const executeQueueName = this.buildQueueName(queuePrefix, normalizedName, 'execute');
            const ExecuteConsumer = ActivityExecuteConsumerFactory.createConsumer(
                activityName,
                new activityClass() as any
            );

            rabbitmqConfig.ReceiveEndpoint(executeQueueName, (e: any) => {
                e.ConfigureConsumer(ExecuteConsumer, context, (c: any) => {
                    // Optional: Add retry policy
                    // c.UseMessageRetry(r => r.Immediate(3));
                });
            });

            // Configure compensate endpoint if activity supports compensation
            const activityInstance = new activityClass();
            if (this.isCompensatableActivity(activityInstance)) {
                const compensateQueueName = this.buildQueueName(queuePrefix, normalizedName, 'compensate');
                const CompensateConsumer = ActivityCompensateConsumerFactory.createConsumer(
                    activityName,
                    activityInstance
                );

                rabbitmqConfig.ReceiveEndpoint(compensateQueueName, (e: any) => {
                    e.ConfigureConsumer(CompensateConsumer, context, (c: any) => {
                        // Optional: Add retry policy for compensation
                        // c.UseMessageRetry(r => r.Immediate(3));
                    });
                });
            }
        });

        logger.log(`Endpoint configuration complete - ${activities.length} activities configured`);
    }

    /**
     * Build queue name with prefix and suffix
     */
    private static buildQueueName(prefix: string, baseName: string, suffix: string): string {
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
    private static normalizeActivityName(activityName: string): string {
        return activityName
            .replace(/([A-Z])/g, '-$1')
            .toLowerCase()
            .replace(/^-/, '');
    }

    /**
     * Check if activity supports compensation
     */
    private static isCompensatableActivity<TArguments, TLog>(
        activity: IActivity<TArguments, TLog> | IExecuteActivity<TArguments>
    ): activity is IActivity<TArguments, TLog> {
        return 'compensate' in activity && typeof activity.compensate === 'function';
    }
}
