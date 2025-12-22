/**
 * Validate Inventory Activity
 * Example activity that demonstrates compensation when validation fails
 */

import { Injectable, Logger } from '@nestjs/common';
import { IActivity, IActivityResult, ICompensateContext, IExecuteContext, RoutingSlipActivity } from 'nestjs-bustransit';

/**
 * Arguments for ValidateInventory activity
 */
export interface ValidateInventoryArguments {
    orderId: string;
    items: Array<{ sku: string; quantity: number }>;
    shouldFail?: boolean; // For testing compensation
}

/**
 * Compensation log for ValidateInventory
 */
export interface ValidateInventoryLog {
    validationId: string;
    items: Array<{ sku: string; quantity: number }>;
    timestamp: Date;
}

/**
 * Activity to validate inventory availability
 * This activity can be configured to fail to demonstrate compensation
 */
@RoutingSlipActivity({ name: 'ValidateInventory' })
@Injectable()
export class ValidateInventoryActivity implements IActivity<ValidateInventoryArguments, ValidateInventoryLog> {
    name = 'ValidateInventory';

    async execute(context: IExecuteContext<ValidateInventoryArguments>): Promise<IActivityResult> {
        try {
            Logger.log(`[ValidateInventory] Validating inventory for order ${context.args.orderId}`);
            Logger.log(`[ValidateInventory] Items: ${JSON.stringify(context.args.items)}`);

            // Simulate validation
            const validationId = `val_${Date.now()}_${context.args.orderId}`;

            // Check if we should fail (for testing compensation)
            if (context.args.shouldFail) {
                Logger.error(`[ValidateInventory] Inventory validation failed - insufficient stock`);
                throw new Error('Insufficient inventory for order');
            }

            // Store validation ID in variables
            const variables = new Map(context.variables);
            variables.set('validationId', validationId);

            // Create compensation log
            const compensationLog: ValidateInventoryLog = {
                validationId,
                items: context.args.items,
                timestamp: new Date()
            };

            Logger.log(`[ValidateInventory] Inventory validated successfully: ${validationId}`);

            return context.completedWithVariables(variables, compensationLog);

        } catch (error) {
            Logger.error(`[ValidateInventory] Failed to validate inventory: ${error.message}`);
            return context.faulted(error);
        }
    }

    async compensate(context: ICompensateContext<ValidateInventoryLog>): Promise<void> {
        Logger.log(`[ValidateInventory] Compensating validation: ${context.compensationLog.validationId}`);
        Logger.log(`[ValidateInventory] Rolling back validation for items: ${JSON.stringify(context.compensationLog.items)}`);

        // Simulate compensation
        await new Promise(resolve => setTimeout(resolve, 100));

        Logger.log(`[ValidateInventory] Validation rolled back successfully`);
    }
}
