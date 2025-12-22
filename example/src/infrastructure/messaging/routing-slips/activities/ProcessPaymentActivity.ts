/**
 * Process Payment Activity
 * Example activity that processes payment with compensation support
 */

import { Injectable, Logger } from '@nestjs/common';
import { IActivity, IActivityResult, ICompensateContext, IExecuteContext, RoutingSlipActivity } from 'nestjs-bustransit';

/**
 * Arguments for ProcessPayment activity
 */
export interface ProcessPaymentArguments {
    orderId: string;
    amount: number;
    customerId: string;
}

/**
 * Compensation log for ProcessPayment
 */
export interface ProcessPaymentLog {
    paymentIntentId: string;
    amount: number;
    timestamp: Date;
}

/**
 * Activity to process payment for an order
 */
@RoutingSlipActivity({ name: 'ProcessPayment' })
@Injectable()
export class ProcessPaymentActivity implements IActivity<ProcessPaymentArguments, ProcessPaymentLog> {
    name = 'ProcessPayment';

    async execute(context: IExecuteContext<ProcessPaymentArguments>): Promise<IActivityResult> {
        try {
            Logger.log(`[ProcessPayment] Processing payment for order ${context.args.orderId}`);
            Logger.log(`[ProcessPayment] Amount: $${context.args.amount}`);

            // Simulate payment processing
            const paymentIntentId = `pi_${Date.now()}_${context.args.orderId}`;

            // Store payment intent ID in variables for later activities
            const variables = new Map(context.variables);
            variables.set('paymentIntentId', paymentIntentId);

            // Create compensation log
            const compensationLog: ProcessPaymentLog = {
                paymentIntentId,
                amount: context.args.amount,
                timestamp: new Date()
            };

            Logger.log(`[ProcessPayment] Payment processed successfully: ${paymentIntentId}`);

            return context.completedWithVariables(variables, compensationLog);

        } catch (error) {
            Logger.error(`[ProcessPayment] Failed to process payment: ${error.message}`);
            return context.faulted(error);
        }
    }

    async compensate(context: ICompensateContext<ProcessPaymentLog>): Promise<void> {
        Logger.log(`[ProcessPayment] Compensating payment: ${context.compensationLog.paymentIntentId}`);
        Logger.log(`[ProcessPayment] Refunding amount: $${context.compensationLog.amount}`);

        // Simulate payment refund
        await new Promise(resolve => setTimeout(resolve, 100));

        Logger.log(`[ProcessPayment] Payment refunded successfully`);
    }
}
