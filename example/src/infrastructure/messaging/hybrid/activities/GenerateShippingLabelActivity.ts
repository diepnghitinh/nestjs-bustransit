/**
 * Generate Shipping Label Activity
 * Part of the fulfillment routing slip - generates shipping label for package
 */

import { Injectable, Logger } from '@nestjs/common';
import { IActivity, IActivityResult, ICompensateContext, IExecuteContext, RoutingSlipActivity } from 'nestjs-bustransit';

export interface GenerateShippingLabelArguments {
    orderId: string;
}

export interface GenerateShippingLabelLog {
    labelId: string;
    trackingNumber: string;
    carrier: string;
    timestamp: Date;
}

@RoutingSlipActivity({ name: 'GenerateShippingLabel' })
@Injectable()
export class GenerateShippingLabelActivity implements IActivity<GenerateShippingLabelArguments, GenerateShippingLabelLog> {
    name = 'GenerateShippingLabel';

    async execute(context: IExecuteContext<GenerateShippingLabelArguments>): Promise<IActivityResult> {
        try {
            Logger.log(`[GenerateShippingLabel] Generating label for order ${context.args.orderId}`);

            // Get package data from previous activity
            const packageId = context.variables.get('packageId');
            const weight = context.variables.get('weight');
            const warehouseId = context.variables.get('warehouseId');

            // Simulate label generation
            const labelId = `LBL-${Date.now()}-${context.args.orderId}`;
            const trackingNumber = `TRK${Math.random().toString(36).substring(2, 15).toUpperCase()}`;
            const carrier = weight > 5 ? 'FedEx' : 'USPS';

            Logger.log(`[GenerateShippingLabel] Label generated for package ${packageId}`);
            Logger.log(`[GenerateShippingLabel] Tracking: ${trackingNumber} via ${carrier}`);
            Logger.log(`[GenerateShippingLabel] Shipping from: ${warehouseId}`);

            // Store shipping data
            const variables = new Map(context.variables);
            variables.set('labelId', labelId);
            variables.set('trackingNumber', trackingNumber);
            variables.set('carrier', carrier);

            const compensationLog: GenerateShippingLabelLog = {
                labelId,
                trackingNumber,
                carrier,
                timestamp: new Date()
            };

            Logger.log(`[GenerateShippingLabel] Label created: ${labelId}`);

            return context.completedWithVariables(variables, compensationLog);

        } catch (error) {
            Logger.error(`[GenerateShippingLabel] Failed to generate label: ${error.message}`);
            return context.faulted(error);
        }
    }

    async compensate(context: ICompensateContext<GenerateShippingLabelLog>): Promise<void> {
        Logger.log(`[GenerateShippingLabel] Compensating label: ${context.compensationLog.labelId}`);
        Logger.log(`[GenerateShippingLabel] Voiding tracking number: ${context.compensationLog.trackingNumber}`);
        Logger.log(`[GenerateShippingLabel] Carrier: ${context.compensationLog.carrier}`);

        // Simulate label cancellation with carrier
        await new Promise(resolve => setTimeout(resolve, 100));

        Logger.log(`[GenerateShippingLabel] Shipping label voided successfully`);
    }
}
