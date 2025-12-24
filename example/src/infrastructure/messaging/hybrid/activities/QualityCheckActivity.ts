/**
 * Quality Check Activity
 * Part of the fulfillment routing slip - performs quality check on package
 * This activity can fail to demonstrate compensation
 */

import { Injectable, Logger } from '@nestjs/common';
import { IActivity, IActivityResult, ICompensateContext, IExecuteContext, RoutingSlipActivity } from 'nestjs-bustransit';

export interface QualityCheckArguments {
    orderId: string;
    shouldFail?: boolean;
}

export interface QualityCheckLog {
    inspectionId: string;
    inspector: string;
    timestamp: Date;
}

@RoutingSlipActivity({ name: 'QualityCheck' })
@Injectable()
export class QualityCheckActivity implements IActivity<QualityCheckArguments, QualityCheckLog> {
    name = 'QualityCheck';

    async execute(context: IExecuteContext<QualityCheckArguments>): Promise<IActivityResult> {
        try {
            Logger.log(`[QualityCheck] Inspecting package for order ${context.args.orderId}`);

            // Get package data
            const packageId = context.variables.get('packageId');
            const labelId = context.variables.get('labelId');
            const trackingNumber = context.variables.get('trackingNumber');

            const inspectionId = `QC-${Date.now()}-${context.args.orderId}`;
            const inspector = `Inspector-${Math.floor(Math.random() * 5) + 1}`;

            Logger.log(`[QualityCheck] Inspector: ${inspector}`);
            Logger.log(`[QualityCheck] Package: ${packageId}`);
            Logger.log(`[QualityCheck] Label: ${labelId}`);
            Logger.log(`[QualityCheck] Tracking: ${trackingNumber}`);

            // Simulate quality check that can fail
            if (context.args.shouldFail) {
                Logger.error(`[QualityCheck] FAILED: Package damaged or label incorrect`);
                throw new Error('Quality check failed: Package does not meet standards');
            }

            Logger.log(`[QualityCheck] ✓ Package integrity verified`);
            Logger.log(`[QualityCheck] ✓ Label accuracy verified`);
            Logger.log(`[QualityCheck] ✓ Contents match order`);

            const variables = new Map(context.variables);
            variables.set('inspectionId', inspectionId);
            variables.set('inspector', inspector);
            variables.set('qualityApproved', true);

            const compensationLog: QualityCheckLog = {
                inspectionId,
                inspector,
                timestamp: new Date()
            };

            Logger.log(`[QualityCheck] Quality check passed: ${inspectionId}`);

            return context.completedWithVariables(variables, compensationLog);

        } catch (error) {
            Logger.error(`[QualityCheck] Quality check failed: ${error.message}`);
            return context.faulted(error);
        }
    }

    async compensate(context: ICompensateContext<QualityCheckLog>): Promise<void> {
        Logger.log(`[QualityCheck] Compensating inspection: ${context.compensationLog.inspectionId}`);
        Logger.log(`[QualityCheck] Inspector: ${context.compensationLog.inspector}`);
        Logger.log(`[QualityCheck] Marking package for re-inspection`);

        // Simulate updating inspection records
        await new Promise(resolve => setTimeout(resolve, 100));

        Logger.log(`[QualityCheck] Inspection record updated successfully`);
    }
}
