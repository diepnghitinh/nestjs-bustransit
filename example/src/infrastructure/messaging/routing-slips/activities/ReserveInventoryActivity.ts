/**
 * Reserve Inventory Activity
 * Example activity that reserves inventory with compensation support
 */

import { Injectable, Logger } from '@nestjs/common';
import { IActivity, IActivityResult, ICompensateContext, IExecuteContext } from 'nestjs-bustransit';

/**
 * Arguments for ReserveInventory activity
 */
export interface ReserveInventoryArguments {
    orderId: string;
    items: Array<{ sku: string; quantity: number }>;
}

/**
 * Compensation log for ReserveInventory
 */
export interface ReserveInventoryLog {
    reservationId: string;
    items: Array<{ sku: string; quantity: number }>;
    timestamp: Date;
}

/**
 * Activity to reserve inventory for an order
 */
@Injectable()
export class ReserveInventoryActivity implements IActivity<ReserveInventoryArguments, ReserveInventoryLog> {
    name = 'ReserveInventory';

    async execute(context: IExecuteContext<ReserveInventoryArguments>): Promise<IActivityResult> {
        try {
            Logger.log(`[ReserveInventory] Reserving inventory for order ${context.args.orderId}`);
            Logger.log(`[ReserveInventory] Items: ${JSON.stringify(context.args.items)}`);

            // Simulate inventory reservation
            const reservationId = `res_${Date.now()}_${context.args.orderId}`;

            // Store reservation ID in variables
            const variables = new Map(context.variables);
            variables.set('reservationId', reservationId);

            // Create compensation log
            const compensationLog: ReserveInventoryLog = {
                reservationId,
                items: context.args.items,
                timestamp: new Date()
            };

            Logger.log(`[ReserveInventory] Inventory reserved successfully: ${reservationId}`);

            return context.completedWithVariables(variables, compensationLog);

        } catch (error) {
            Logger.error(`[ReserveInventory] Failed to reserve inventory: ${error.message}`);
            return context.faulted(error);
        }
    }

    async compensate(context: ICompensateContext<ReserveInventoryLog>): Promise<void> {
        Logger.log(`[ReserveInventory] Compensating reservation: ${context.compensationLog.reservationId}`);
        Logger.log(`[ReserveInventory] Releasing items: ${JSON.stringify(context.compensationLog.items)}`);

        // Simulate inventory release
        await new Promise(resolve => setTimeout(resolve, 100));

        Logger.log(`[ReserveInventory] Inventory released successfully`);
    }
}
