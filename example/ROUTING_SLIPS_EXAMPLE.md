# Routing Slips Pattern Example

This directory contains a complete example of the Routing Slips pattern implementation in NestJS BusTransit.

## Overview

The Routing Slips pattern is a powerful way to coordinate distributed transactions across multiple activities, with automatic compensation (rollback) if any step fails. This example demonstrates:

- Automatic activity discovery using decorators
- Sequential activity execution
- Variable sharing between activities
- Automatic compensation when failures occur
- Event monitoring for tracking execution
- Both successful and failing scenarios

## Architecture

### Activities

The example includes the following activities:

1. **ProcessPaymentActivity** - Processes payment for an order
   - **Execute**: Charges the customer and stores payment intent ID
   - **Compensate**: Refunds the payment

2. **ReserveInventoryActivity** - Reserves inventory items
   - **Execute**: Reserves stock for the order items
   - **Compensate**: Releases the reserved inventory

3. **ValidateInventoryActivity** - Validates inventory availability (can fail for testing)
   - **Execute**: Validates stock availability (can be set to fail)
   - **Compensate**: Rolls back validation

4. **SendConfirmationActivity** - Sends order confirmation email (execute-only)
   - **Execute**: Sends confirmation email
   - **No Compensation**: Emails cannot be "unsent"

### Service

**OrderProcessingService** - Orchestrates order processing using routing slips
- `processOrder()` - Successful order processing flow
- `processOrderWithFailure()` - Demonstrates compensation on failure

## Quick Start

### 1. Run the Application

```bash
npm install
npm run build
npm run start:dev
```

### 2. Test Successful Flow

```bash
curl http://localhost:3000/test-routing-slip
```

This will execute a successful order processing flow:
1. ProcessPayment - Completes successfully
2. ReserveInventory - Completes successfully
3. SendConfirmation - Completes successfully

Expected response:
```json
{
  "success": true,
  "message": "Routing slip executed successfully",
  "orderId": "...",
  "activities": ["ProcessPayment", "ReserveInventory", "SendConfirmation"]
}
```

### 3. Test Compensation Flow

```bash
curl http://localhost:3000/test-routing-slip-compensation
```

This will demonstrate automatic compensation:
1. ProcessPayment - Completes successfully
2. ReserveInventory - Completes successfully
3. ValidateInventory - **FAILS intentionally**
4. **Automatic Compensation (in reverse order):**
   - Compensate ReserveInventory
   - Compensate ProcessPayment

Expected response:
```json
{
  "success": false,
  "message": "Routing slip failed as expected - compensation executed",
  "orderId": "...",
  "error": "Insufficient inventory for order",
  "compensatedActivities": ["ReserveInventory", "ProcessPayment"],
  "note": "Check the logs to see the compensation in action..."
}
```

## Understanding the Code

### 1. Activity Definition

Activities are defined with the `@RoutingSlipActivity()` decorator:

```typescript
@RoutingSlipActivity({ name: 'ProcessPayment' })
@Injectable()
export class ProcessPaymentActivity implements IActivity<ProcessPaymentArguments, ProcessPaymentLog> {
    name = 'ProcessPayment';

    async execute(context: IExecuteContext<ProcessPaymentArguments>): Promise<IActivityResult> {
        // Execute logic
        const paymentId = await this.processPayment(context.args);

        // Return with compensation log
        return context.completedWithVariables(
            new Map([['paymentId', paymentId]]),
            { paymentId, amount: context.args.amount }
        );
    }

    async compensate(context: ICompensateContext<ProcessPaymentLog>): Promise<void> {
        // Compensation logic
        await this.refundPayment(context.compensationLog.paymentId);
    }
}
```

### 2. Execute-Only Activity

Some activities don't support compensation:

```typescript
@RoutingSlipActivity({ name: 'SendConfirmation' })
@Injectable()
export class SendConfirmationActivity implements IExecuteActivity<SendConfirmationArguments> {
    name = 'SendConfirmation';

    async execute(context: IExecuteContext<SendConfirmationArguments>): Promise<IActivityResult> {
        await this.sendEmail(context.args.customerEmail);
        return context.completed();
    }

    // No compensate method - emails cannot be "unsent"
}
```

### 3. Module Configuration

Configure the routing slip module in your app module:

```typescript
@Module({
    imports: [
        RoutingSlipModule.forRoot({
            executionMode: RoutingSlipExecutionMode.InProcess,
            enableEventSubscribers: true
        })
    ],
    providers: [
        // Activities are auto-discovered via @RoutingSlipActivity decorator
        ProcessPaymentActivity,
        ReserveInventoryActivity,
        SendConfirmationActivity,
        ValidateInventoryActivity,
    ]
})
export class AppModule {}
```

### 4. Building and Executing Routing Slips

```typescript
@Injectable()
export class OrderProcessingService {
    constructor(private readonly routingSlipService: RoutingSlipService) {
        // Subscribe to events
        this.routingSlipService.subscribe(this.createEventSubscriber());
    }

    async processOrder(orderId: string, amount: number, ...): Promise<void> {
        // Build the routing slip
        const routingSlip = this.routingSlipService.createBuilder(orderId)
            .addActivity('ProcessPayment', 'payment-service', {
                orderId,
                amount,
                customerId
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
            .build();

        // Execute the routing slip
        await this.routingSlipService.execute(routingSlip);
    }
}
```

### 5. Event Monitoring

Subscribe to routing slip events to monitor execution:

```typescript
private createEventSubscriber(): IRoutingSlipEventSubscriber {
    return {
        async onCompleted(event) {
            console.log(`Routing slip completed: ${event.trackingNumber}`);
        },

        async onActivityFaulted(event) {
            console.error(`Activity failed: ${event.activityName}`);
        },

        async onActivityCompensated(event) {
            console.log(`Activity compensated: ${event.activityName}`);
        }
    };
}
```

## Key Concepts

### Activity Execution Flow

1. Activities execute sequentially in the order they were added
2. Each activity can access variables set by previous activities
3. Each activity can add new variables for subsequent activities
4. Activities can store compensation logs for rollback

### Compensation Flow

When an activity fails:

1. The routing slip enters compensation mode
2. Previously completed activities are compensated in **reverse order** (LIFO)
3. Each activity's `compensate()` method receives its compensation log
4. Compensation continues until all activities are undone

### Variable Sharing

Activities can share data through variables:

```typescript
// Activity 1: Set a variable
const variables = new Map(context.variables);
variables.set('paymentId', paymentId);
return context.completedWithVariables(variables, compensationLog);

// Activity 2: Read the variable
const paymentId = context.variables.get('paymentId');
```

### Compensation Logs

Compensation logs store the data needed to undo an activity:

```typescript
// Store data during execute
const compensationLog: ProcessPaymentLog = {
    paymentIntentId,
    amount: context.args.amount,
    timestamp: new Date()
};
return context.completedWithVariables(variables, compensationLog);

// Use data during compensate
async compensate(context: ICompensateContext<ProcessPaymentLog>): Promise<void> {
    await this.refund(context.compensationLog.paymentIntentId);
}
```

## Logs Output

### Successful Execution

```
[OrderProcessing] Starting order processing: 01234567-89ab-cdef-0123-456789abcdef
[OrderProcessing] Routing slip created: 01234567-89ab-cdef-0123-456789abcdef
[ProcessPayment] Processing payment for order 01234567-89ab-cdef-0123-456789abcdef
[ProcessPayment] Amount: $199.99
[ProcessPayment] Payment processed successfully: pi_1234567890_01234567
[EVENT] Activity completed: ProcessPayment (150ms)
[ReserveInventory] Reserving inventory for order 01234567-89ab-cdef-0123-456789abcdef
[ReserveInventory] Items: [{"sku":"PROD-001","quantity":2},{"sku":"PROD-002","quantity":1}]
[ReserveInventory] Inventory reserved successfully: res_1234567890_01234567
[EVENT] Activity completed: ReserveInventory (120ms)
[SendConfirmation] Sending confirmation for order 01234567-89ab-cdef-0123-456789abcdef
[SendConfirmation] Email: customer@example.com
[SendConfirmation] Payment: pi_1234567890_01234567
[SendConfirmation] Reservation: res_1234567890_01234567
[SendConfirmation] Confirmation email sent successfully
[EVENT] Activity completed: SendConfirmation (100ms)
[EVENT] Routing slip completed: 01234567-89ab-cdef-0123-456789abcdef (370ms)
[OrderProcessing] Order processed successfully: 01234567-89ab-cdef-0123-456789abcdef
```

### Compensation Flow

```
[OrderProcessing] Starting order processing with intentional failure: 01234567-89ab-cdef-0123-456789abcdef
[OrderProcessing] This will demonstrate automatic compensation (rollback)
[ProcessPayment] Processing payment for order 01234567-89ab-cdef-0123-456789abcdef
[ProcessPayment] Payment processed successfully: pi_1234567890_01234567
[EVENT] Activity completed: ProcessPayment (150ms)
[ReserveInventory] Reserving inventory for order 01234567-89ab-cdef-0123-456789abcdef
[ReserveInventory] Inventory reserved successfully: res_1234567890_01234567
[EVENT] Activity completed: ReserveInventory (120ms)
[ValidateInventory] Validating inventory for order 01234567-89ab-cdef-0123-456789abcdef
[ValidateInventory] Inventory validation failed - insufficient stock
[ValidateInventory] Failed to validate inventory: Insufficient inventory for order
[EVENT] Activity faulted: ValidateInventory - Insufficient inventory for order
[ReserveInventory] Compensating reservation: res_1234567890_01234567
[ReserveInventory] Releasing items: [{"sku":"PROD-001","quantity":2},{"sku":"PROD-002","quantity":1}]
[ReserveInventory] Inventory released successfully
[EVENT] Activity compensated: ReserveInventory
[ProcessPayment] Compensating payment: pi_1234567890_01234567
[ProcessPayment] Refunding amount: $199.99
[ProcessPayment] Payment refunded successfully
[EVENT] Activity compensated: ProcessPayment
[EVENT] Routing slip faulted: 01234567-89ab-cdef-0123-456789abcdef
[OrderProcessing] Order processing failed: 01234567-89ab-cdef-0123-456789abcdef - Insufficient inventory for order
[OrderProcessing] Compensation should have been triggered for all completed activities
```

## Best Practices

1. **Keep Activities Small** - Each activity should have a single, well-defined responsibility
2. **Design for Compensation** - Always consider how to undo an activity when implementing it
3. **Store Necessary Data** - Save all data needed for compensation in the compensation log
4. **Use Descriptive Names** - Activity names should clearly describe what they do
5. **Handle Errors Gracefully** - Use proper error handling and return meaningful error messages
6. **Monitor Events** - Subscribe to events for logging, monitoring, and alerting
7. **Test Compensation** - Always test both success and failure scenarios

## Advanced Features

### Feature Modules

Organize activities by domain using feature modules:

```typescript
@Module({
    imports: [
        RoutingSlipModule.forFeature([
            ProcessPaymentActivity,
            RefundPaymentActivity
        ])
    ],
    providers: [
        ProcessPaymentActivity,
        RefundPaymentActivity,
        PaymentService
    ],
    exports: [PaymentService]
})
export class PaymentModule {}
```

### Async Configuration

Configure using async providers:

```typescript
RoutingSlipModule.forRootAsync({
    useFactory: (configService: ConfigService) => ({
        executionMode: configService.get('ROUTING_SLIP_MODE'),
        queuePrefix: configService.get('QUEUE_PREFIX')
    }),
    inject: [ConfigService]
})
```

## Comparison with MassTransit

NestJS BusTransit's routing slip implementation is inspired by MassTransit (.NET):

| Feature | MassTransit | NestJS BusTransit |
|---------|-------------|-------------------|
| Activity Registration | `AddActivity<T, TArgs, TLog>()` | `@RoutingSlipActivity()` decorator |
| Discovery | Reflection-based | NestJS Discovery Service |
| Execution | Distributed via message broker | In-process (distributed coming soon) |
| Configuration | Startup.cs / Program.cs | Module `forRoot()` |
| Compensation | Automatic (LIFO) | Automatic (LIFO) |

## Next Steps

- Explore the activity implementations in `src/infrastructure/messaging/routing-slips/activities/`
- Review the service orchestration in `OrderProcessingService.ts`
- Check the module configuration in `app.module.ts`
- Try modifying activities to add custom logic
- Implement your own activities for your use case

## Resources

- [Routing Slips Configuration Guide](../ROUTING_SLIPS_Configure.md)
- [MassTransit Routing Slip Documentation](https://masstransit-project.com/usage/sagas/routing-slip.html)
- [NestJS Dependency Injection](https://docs.nestjs.com/fundamentals/custom-providers)
