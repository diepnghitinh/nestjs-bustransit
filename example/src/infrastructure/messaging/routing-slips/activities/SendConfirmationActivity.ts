/**
 * Send Confirmation Activity
 * Example execute-only activity without compensation
 */

import { Injectable, Logger } from '@nestjs/common';
import { IActivityResult, IExecuteActivity, IExecuteContext } from 'nestjs-bustransit';

/**
 * Arguments for SendConfirmation activity
 */
export interface SendConfirmationArguments {
    orderId: string;
    customerEmail: string;
}

/**
 * Activity to send order confirmation email
 * This is an execute-only activity - emails cannot be "unsent"
 */
@Injectable()
export class SendConfirmationActivity implements IExecuteActivity<SendConfirmationArguments> {
    name = 'SendConfirmation';

    async execute(context: IExecuteContext<SendConfirmationArguments>): Promise<IActivityResult> {
        try {
            Logger.log(`[SendConfirmation] Sending confirmation for order ${context.args.orderId}`);
            Logger.log(`[SendConfirmation] Email: ${context.args.customerEmail}`);

            // Get data from previous activities via variables
            const paymentIntentId = context.variables.get('paymentIntentId');
            const reservationId = context.variables.get('reservationId');

            Logger.log(`[SendConfirmation] Payment: ${paymentIntentId}`);
            Logger.log(`[SendConfirmation] Reservation: ${reservationId}`);

            // Simulate sending email
            await new Promise(resolve => setTimeout(resolve, 100));

            Logger.log(`[SendConfirmation] Confirmation email sent successfully`);

            return context.completed();

        } catch (error) {
            Logger.error(`[SendConfirmation] Failed to send confirmation: ${error.message}`);
            return context.faulted(error);
        }
    }
}
