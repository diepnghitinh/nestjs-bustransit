/**
 * Pick Items Activity
 * Part of the fulfillment routing slip - picks items from warehouse shelves
 */

import { Injectable, Logger } from '@nestjs/common';
import { IActivity, IActivityResult, ICompensateContext, IExecuteContext, RoutingSlipActivity } from 'nestjs-bustransit';

export interface PickItemsArguments {
    orderId: string;
    items: Array<{ sku: string; quantity: number }>;
    warehouseId?: string;
}

export interface PickItemsLog {
    pickListId: string;
    warehouseId: string;
    items: Array<{ sku: string; quantity: number; location: string }>;
    timestamp: Date;
}

@RoutingSlipActivity({ name: 'PickItems' })
@Injectable()
export class PickItemsActivity implements IActivity<PickItemsArguments, PickItemsLog> {
    name = 'PickItems';

    async execute(context: IExecuteContext<PickItemsArguments>): Promise<IActivityResult> {
        try {
            Logger.log(`[PickItems] Picking items for order ${context.args.orderId}`);

            // Simulate warehouse selection
            const warehouseId = context.args.warehouseId || `WH-${Math.floor(Math.random() * 3) + 1}`;
            const pickListId = `PICK-${Date.now()}-${context.args.orderId}`;

            // Simulate picking items with locations
            const pickedItems = context.args.items.map(item => ({
                ...item,
                location: `${warehouseId}-A${Math.floor(Math.random() * 10) + 1}-${Math.floor(Math.random() * 20) + 1}`
            }));

            Logger.log(`[PickItems] Items picked from warehouse ${warehouseId}:`);
            pickedItems.forEach(item => {
                Logger.log(`  - ${item.quantity}x ${item.sku} from ${item.location}`);
            });

            // Store data in variables for subsequent activities
            const variables = new Map(context.variables);
            variables.set('pickListId', pickListId);
            variables.set('warehouseId', warehouseId);
            variables.set('pickedItems', pickedItems);

            const compensationLog: PickItemsLog = {
                pickListId,
                warehouseId,
                items: pickedItems,
                timestamp: new Date()
            };

            Logger.log(`[PickItems] Pick completed: ${pickListId}`);

            return context.completedWithVariables(variables, compensationLog);

        } catch (error) {
            Logger.error(`[PickItems] Failed to pick items: ${error.message}`);
            return context.faulted(error);
        }
    }

    async compensate(context: ICompensateContext<PickItemsLog>): Promise<void> {
        Logger.log(`[PickItems] Compensating pick list: ${context.compensationLog.pickListId}`);
        Logger.log(`[PickItems] Returning items to warehouse ${context.compensationLog.warehouseId}:`);

        context.compensationLog.items.forEach(item => {
            Logger.log(`  - ${item.quantity}x ${item.sku} to ${item.location}`);
        });

        // Simulate returning items to shelves
        await new Promise(resolve => setTimeout(resolve, 100));

        Logger.log(`[PickItems] Items returned to warehouse successfully`);
    }
}
