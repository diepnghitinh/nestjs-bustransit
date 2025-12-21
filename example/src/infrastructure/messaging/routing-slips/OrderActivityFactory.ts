/**
 * Activity Factory for Order Processing
 * Creates activity instances for routing slip execution
 */

import { Injectable } from '@nestjs/common';
import { ProcessPaymentActivity } from './activities/ProcessPaymentActivity';
import { ReserveInventoryActivity } from './activities/ReserveInventoryActivity';
import { SendConfirmationActivity } from './activities/SendConfirmationActivity';
import { IActivityFactory } from 'nestjs-bustransit';

/**
 * Factory for creating order processing activities
 */
@Injectable()
export class OrderActivityFactory implements IActivityFactory {
    private activities = new Map();

    constructor(
        private readonly processPaymentActivity: ProcessPaymentActivity,
        private readonly reserveInventoryActivity: ReserveInventoryActivity,
        private readonly sendConfirmationActivity: SendConfirmationActivity
    ) {
        // Register activities
        this.activities.set('ProcessPayment', this.processPaymentActivity);
        this.activities.set('ReserveInventory', this.reserveInventoryActivity);
        this.activities.set('SendConfirmation', this.sendConfirmationActivity);
    }

    createActivity<TArguments, TLog>(activityName: string): any {
        const activity = this.activities.get(activityName);
        if (!activity) {
            throw new Error(`Activity not found: ${activityName}`);
        }
        return activity;
    }
}
