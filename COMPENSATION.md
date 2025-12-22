# Routing Slip Compensation Pattern

This library supports the **Compensation Pattern** for routing slips, allowing you to define compensating transactions that automatically roll back completed activities when an activity fails.

## Overview

The compensation pattern ensures data consistency in distributed workflows by:
1. **Tracking** each successful activity execution with compensation logs
2. **Executing compensations** in reverse order when a failure occurs
3. **Maintaining routing slip state** including all compensation activities

## Key Features

- **Automatic tracking**: Compensation logs are automatically tracked as activities execute
- **Reverse execution**: Compensations execute in reverse order (LIFO - Last In, First Out)
- **Flexible compensation**: Define compensation logic for any activity
- **Rich logging**: Detailed logs for compensation tracking and execution
- **Event-driven monitoring**: Subscribe to compensation events for observability

## Activity Interface

Activities can optionally implement compensation logic:

```typescript
export interface IActivity<TArguments, TLog = any> {
    name: string;
    execute(context: IExecuteContext<TArguments>): Promise<IActivityResult>;
    compensate(context: ICompensateContext<TLog>): Promise<void>;  // Optional compensation method
}

export interface IExecuteActivity<TArguments> {
    name: string;
    execute(context: IExecuteContext<TArguments>): Promise<IActivityResult>;
    // No compensation - execute-only activity
}
```

## Compensation Context

The compensation context provides access to the original activity's compensation log:

```typescript
export interface ICompensateContext<TLog> {
    trackingNumber: string;
    compensationLog: TLog;
    variables: Map<string, any>;
}
```

## Usage Example

### Basic Routing Slip with Compensation

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { RoutingSlipBuilder } from '@bustransit/routing-slip';

@Injectable()
export class OrderProcessingService {
    constructor(
        private readonly executor: RoutingSlipExecutor,
    ) {}

    async processOrder(orderId: string, amount: number, items: any[], customerEmail: string): Promise<void> {
        try {
            // Build routing slip with activities
            const routingSlip = RoutingSlipBuilder.create(orderId)
                .addActivity('ProcessPayment', 'payment-service', {
                    orderId,
                    amount,
                    customerId: 'customer-123'
                })
                .addActivity('ReserveInventory', 'inventory-service', {
                    orderId,
                    items
                })
                .addActivity('SendConfirmation', 'notification-service', {
                    orderId,
                    customerEmail
                })
                .addVariable('orderId', orderId)
                .addVariable('customerEmail', customerEmail)
                .build();

            // Execute routing slip
            // If any activity fails, routing slip executor automatically compensates all completed activities
            await this.executor.execute(routingSlip);

            Logger.log(`Order ${orderId} processed successfully`);
        } catch (error) {
            Logger.error(`Order processing failed: ${orderId}`, error.stack);
            throw error;
        }
    }
}
```

### Activity with Compensation

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { IActivity, IExecuteContext, ICompensateContext, IActivityResult } from '@bustransit/routing-slip';

interface ProcessPaymentArguments {
    orderId: string;
    amount: number;
    customerId: string;
}

interface ProcessPaymentLog {
    paymentIntentId: string;
    amount: number;
    timestamp: Date;
}

@Injectable()
export class ProcessPaymentActivity implements IActivity<ProcessPaymentArguments, ProcessPaymentLog> {
    name = 'ProcessPayment';

    async execute(context: IExecuteContext<ProcessPaymentArguments>): Promise<IActivityResult> {
        Logger.log(`[ProcessPayment] Processing payment for order ${context.args.orderId}`);

        // Simulate payment processing
        const paymentIntentId = `pi_${Date.now()}_${context.args.orderId}`;

        // Create compensation log with data needed for refund
        const compensationLog: ProcessPaymentLog = {
            paymentIntentId,
            amount: context.args.amount,
            timestamp: new Date()
        };

        // Store payment intent ID in routing slip variables for other activities
        const variables = new Map(context.variables);
        variables.set('paymentIntentId', paymentIntentId);

        Logger.log(`[ProcessPayment] Payment processed: ${paymentIntentId}`);

        // Return completed result with compensation log
        return context.completedWithVariables(variables, compensationLog);
    }

    async compensate(context: ICompensateContext<ProcessPaymentLog>): Promise<void> {
        Logger.log(`[ProcessPayment] Compensating payment: ${context.compensationLog.paymentIntentId}`);

        // Refund the payment using compensation log
        Logger.log(`[ProcessPayment] Refunding amount: $${context.compensationLog.amount}`);

        // Simulate refund processing
        await new Promise(resolve => setTimeout(resolve, 100));

        Logger.log(`[ProcessPayment] Payment refunded successfully`);
    }
}
```

### Activity with Compensation

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { IActivity, IExecuteContext, ICompensateContext, IActivityResult } from '@bustransit/routing-slip';

interface ReserveInventoryArguments {
    orderId: string;
    items: Array<{ productId: string; quantity: number }>;
}

interface ReserveInventoryLog {
    reservationId: string;
    items: Array<{ productId: string; quantity: number }>;
    timestamp: Date;
}

@Injectable()
export class ReserveInventoryActivity implements IActivity<ReserveInventoryArguments, ReserveInventoryLog> {
    name = 'ReserveInventory';

    async execute(context: IExecuteContext<ReserveInventoryArguments>): Promise<IActivityResult> {
        Logger.log(`[ReserveInventory] Reserving inventory for order ${context.args.orderId}`);

        // Simulate inventory reservation
        const reservationId = `res_${Date.now()}_${context.args.orderId}`;

        // Create compensation log with data needed to release inventory
        const compensationLog: ReserveInventoryLog = {
            reservationId,
            items: context.args.items,
            timestamp: new Date()
        };

        const variables = new Map(context.variables);
        variables.set('reservationId', reservationId);

        Logger.log(`[ReserveInventory] Inventory reserved: ${reservationId}`);

        return context.completedWithVariables(variables, compensationLog);
    }

    async compensate(context: ICompensateContext<ReserveInventoryLog>): Promise<void> {
        Logger.log(`[ReserveInventory] Compensating reservation: ${context.compensationLog.reservationId}`);

        // Release inventory using compensation log
        Logger.log(`[ReserveInventory] Releasing items: ${JSON.stringify(context.compensationLog.items)}`);

        // Simulate inventory release
        await new Promise(resolve => setTimeout(resolve, 100));

        Logger.log(`[ReserveInventory] Inventory released successfully`);
    }
}
```

### Execute-Only Activity (No Compensation)

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { IExecuteActivity, IExecuteContext, IActivityResult } from '@bustransit/routing-slip';

interface SendConfirmationArguments {
    orderId: string;
    customerEmail: string;
}

@Injectable()
export class SendConfirmationActivity implements IExecuteActivity<SendConfirmationArguments> {
    name = 'SendConfirmation';

    async execute(context: IExecuteContext<SendConfirmationArguments>): Promise<IActivityResult> {
        Logger.log(`[SendConfirmation] Sending confirmation for order ${context.args.orderId}`);

        // Get data from previous activities via variables
        const paymentIntentId = context.variables.get('paymentIntentId');
        const reservationId = context.variables.get('reservationId');

        // Send confirmation email (no compensation needed)
        Logger.log(`[SendConfirmation] Email sent to ${context.args.customerEmail}`);
        Logger.log(`[SendConfirmation] Payment: ${paymentIntentId}, Reservation: ${reservationId}`);

        // Return completed without compensation log
        return context.completed();
    }

    // No compensate() method - this is an execute-only activity
    // Sending an email doesn't need to be compensated
}
```

## How It Works

### 1. Automatic Tracking

When an activity executes successfully and returns a compensation log, the routing slip executor automatically tracks it:

```typescript
{
    activityName: "ProcessPayment",
    compensationLog: {
        paymentIntentId: "pi_123",
        amount: 99.99,
        timestamp: Date
    }
}
```

These logs are stored in: `routingSlip.activityLogs[]`

### 2. Executing Compensations

When an activity fails, the routing slip executor:

1. Reverses the order of completed activities (LIFO)
2. Executes each compensation action in reverse order
3. Provides the original compensation log to each compensation
4. Logs all compensation steps
5. Stores compensated activities in `routingSlip.compensateLogs[]`

### 3. Compensation Flow Example

For the order processing example above:

**Success Flow:**
1. ProcessPayment → Completed (tracked for compensation)
2. ReserveInventory → Completed (tracked for compensation)
3. SendConfirmation → Completed (no compensation needed)
4. Routing Slip Completed

**Failure Flow:**
1. ProcessPayment → Completed (tracked for compensation)
2. ReserveInventory → Completed (tracked for compensation)
3. SendConfirmation → **FAILED**
4. Compensation executes in reverse:
   - Compensate ReserveInventory (release inventory)
   - Compensate ProcessPayment (refund payment)
5. Routing Slip Failed with all compensations completed

## Event-Driven Monitoring

Subscribe to compensation events for observability:

```typescript
import { IRoutingSlipEventSubscriber } from '@bustransit/routing-slip';

@Injectable()
export class RoutingSlipMonitor implements IRoutingSlipEventSubscriber {
    async onActivityExecuted(event: IRoutingSlipActivityExecuted): Promise<void> {
        Logger.log(`Activity executed: ${event.activityName}`);
    }

    async onActivityFaulted(event: IRoutingSlipActivityFaulted): Promise<void> {
        Logger.error(`Activity failed: ${event.activityName}`, event.exception);
    }

    async onActivityCompensated(event: IRoutingSlipActivityCompensated): Promise<void> {
        Logger.log(`Activity compensated: ${event.activityName}`);
        Logger.log(`Compensation log: ${JSON.stringify(event.compensationLog)}`);
    }

    async onCompensationFailed(event: IRoutingSlipCompensationFailed): Promise<void> {
        Logger.error(`Compensation failed for routing slip: ${event.trackingNumber}`);
        Logger.error(`Activity logs: ${JSON.stringify(event.activityLogs)}`);
        Logger.error(`Compensate logs: ${JSON.stringify(event.compensateLogs)}`);
    }

    async onCompleted(event: IRoutingSlipCompleted): Promise<void> {
        Logger.log(`Routing slip completed: ${event.trackingNumber}`);
    }

    async onFaulted(event: IRoutingSlipFaulted): Promise<void> {
        Logger.error(`Routing slip faulted: ${event.trackingNumber}`);
    }
}
```

## Best Practices

1. **Define compensations for all side effects**: Any activity that changes external state should have a compensation

2. **Keep compensations idempotent**: Compensations may be retried, so ensure they can be safely executed multiple times

3. **Log compensation activities**: Use detailed logging to track compensation execution

4. **Handle compensation failures**: Consider what happens if a compensation itself fails

5. **Use compensation logs wisely**: Store only the data needed to undo the action

6. **Execute-only activities**: Activities without side effects (like sending notifications) don't need compensation

## Routing Slip Interfaces

### Activity Result

```typescript
export enum ActivityResultType {
    Complete = 'Complete',
    Fault = 'Fault',
    Terminate = 'Terminate'
}

export interface IActivityResult {
    resultType: ActivityResultType;
    compensationLog?: any;      // Data for compensation
    variables?: Map<string, any>; // Variables to share with next activities
    exception?: Error;           // Error if faulted
}
```

### Execute Context

```typescript
export interface IExecuteContext<TArguments> {
    trackingNumber: string;
    args: TArguments;
    variables: Map<string, any>;

    completed(compensationLog?: any): IActivityResult;
    completedWithVariables(variables: Map<string, any>, compensationLog?: any): IActivityResult;
    faulted(exception: Error): IActivityResult;
    terminate(): IActivityResult;
}
```

## Advanced Usage

### Conditional Compensation

```typescript
async compensate(context: ICompensateContext<ProcessPaymentLog>): Promise<void> {
    // Only refund if payment was actually processed
    if (context.compensationLog.paymentIntentId) {
        await this.paymentService.refund(context.compensationLog.paymentIntentId);
        Logger.log(`Refunded payment: ${context.compensationLog.paymentIntentId}`);
    }
}
```

### Compensation with External Services

```typescript
async compensate(context: ICompensateContext<ReservationLog>): Promise<void> {
    try {
        // Call external service to undo the action
        await this.inventoryService.releaseReservation(
            context.compensationLog.reservationId
        );
        Logger.log(`Released reservation: ${context.compensationLog.reservationId}`);
    } catch (error) {
        Logger.error(`Compensation failed: ${error.message}`);
        // Handle compensation failure - could send alert, log to dead letter queue, etc.
        throw error;
    }
}
```

### Using Variables Across Activities

```typescript
// First activity stores data in variables
async execute(context: IExecuteContext<Args1>): Promise<IActivityResult> {
    const result = await this.process();

    const variables = new Map(context.variables);
    variables.set('resultId', result.id);
    variables.set('timestamp', new Date().toISOString());

    return context.completedWithVariables(variables, { resultId: result.id });
}

// Later activity reads from variables
async execute(context: IExecuteContext<Args2>): Promise<IActivityResult> {
    const resultId = context.variables.get('resultId');
    const timestamp = context.variables.get('timestamp');

    // Use the shared data
    await this.processWithPreviousResult(resultId);

    return context.completed();
}
```
