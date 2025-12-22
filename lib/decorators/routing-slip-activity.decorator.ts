/**
 * Routing Slip Activity Decorator
 * Marks a class as a routing slip activity for automatic registration
 */

import { SetMetadata } from '@nestjs/common';

export const ROUTING_SLIP_ACTIVITY_METADATA = 'ROUTING_SLIP_ACTIVITY_METADATA';

/**
 * Activity configuration options
 */
export interface RoutingSlipActivityOptions {
    /**
     * Activity name (defaults to class name)
     */
    name?: string;

    /**
     * Queue address for distributed execution (optional)
     * If not provided, activity executes in-process
     */
    queueAddress?: string;

    /**
     * Enable automatic queue provisioning
     * Only applies when queueAddress is provided
     */
    autoProvision?: boolean;
}

/**
 * Decorator to mark a class as a routing slip activity
 *
 * @example
 * ```typescript
 * @RoutingSlipActivity({ name: 'ProcessPayment' })
 * @Injectable()
 * export class ProcessPaymentActivity implements IActivity<Args, Log> {
 *   // ...
 * }
 * ```
 */
export function RoutingSlipActivity(options?: RoutingSlipActivityOptions): ClassDecorator {
    return (target: any) => {
        const activityOptions: RoutingSlipActivityOptions = {
            name: options?.name || target.name,
            queueAddress: options?.queueAddress,
            autoProvision: options?.autoProvision ?? true
        };

        SetMetadata(ROUTING_SLIP_ACTIVITY_METADATA, activityOptions)(target);
        return target;
    };
}
