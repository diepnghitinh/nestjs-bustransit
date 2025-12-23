/**
 * Pack Items Activity
 * Part of the fulfillment routing slip - packs picked items into boxes
 */

import { Injectable, Logger } from '@nestjs/common';
import { IActivity, IActivityResult, ICompensateContext, IExecuteContext, RoutingSlipActivity } from 'nestjs-bustransit';

export interface PackItemsArguments {
    orderId: string;
}

export interface PackItemsLog {
    packageId: string;
    boxSize: string;
    weight: number;
    timestamp: Date;
}

@RoutingSlipActivity({ name: 'PackItems' })
@Injectable()
export class PackItemsActivity implements IActivity<PackItemsArguments, PackItemsLog> {
    name = 'PackItems';

    async execute(context: IExecuteContext<PackItemsArguments>): Promise<IActivityResult> {
        try {
            Logger.log(`[PackItems] Packing items for order ${context.args.orderId}`);

            // Get picked items from previous activity
            const pickedItems = context.variables.get('pickedItems') || [];
            const pickListId = context.variables.get('pickListId');

            // Simulate packing
            const packageId = `PKG-${Date.now()}-${context.args.orderId}`;
            const boxSize = pickedItems.length > 3 ? 'Large' : 'Medium';
            const weight = pickedItems.reduce((sum, item) => sum + item.quantity, 0) * 1.5; // Simulate weight

            Logger.log(`[PackItems] Packing ${pickedItems.length} item types from pick list ${pickListId}`);
            Logger.log(`[PackItems] Box size: ${boxSize}, Weight: ${weight}kg`);

            // Store package data
            const variables = new Map(context.variables);
            variables.set('packageId', packageId);
            variables.set('boxSize', boxSize);
            variables.set('weight', weight);

            const compensationLog: PackItemsLog = {
                packageId,
                boxSize,
                weight,
                timestamp: new Date()
            };

            Logger.log(`[PackItems] Package created: ${packageId}`);

            return context.completedWithVariables(variables, compensationLog);

        } catch (error) {
            Logger.error(`[PackItems] Failed to pack items: ${error.message}`);
            return context.faulted(error);
        }
    }

    async compensate(context: ICompensateContext<PackItemsLog>): Promise<void> {
        Logger.log(`[PackItems] Compensating package: ${context.compensationLog.packageId}`);
        Logger.log(`[PackItems] Unpacking ${context.compensationLog.boxSize} box (${context.compensationLog.weight}kg)`);

        // Simulate unpacking
        await new Promise(resolve => setTimeout(resolve, 100));

        Logger.log(`[PackItems] Package unpacked successfully`);
    }
}
