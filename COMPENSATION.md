# Saga Compensation Pattern

This library now supports the **Compensation Pattern** for sagas, allowing you to define compensating transactions that automatically roll back completed steps when a saga fails.

## Overview

The compensation pattern ensures data consistency in distributed transactions by:
1. **Tracking** each successful step that has a compensation action defined
2. **Executing compensations** in reverse order when a failure occurs
3. **Maintaining saga state** including all compensation activities

## Key Features

- **Automatic tracking**: Compensation activities are automatically tracked as saga steps execute
- **Reverse execution**: Compensations execute in reverse order (LIFO - Last In, First Out)
- **Flexible compensation**: Define compensation logic for any saga step
- **Manual control**: Trigger compensations manually when needed
- **Rich logging**: Detailed logs for compensation tracking and execution

## API

### `Compensate(action)`

Add a compensation action to any saga step using the `Compensate()` method:

```typescript
this.When(EventClass)
    .Then(c => {
        // Forward transaction
    })
    .Compensate(async c => {
        // Compensation transaction
    })
    .TransitionTo(nextState)
```

### `Compensate(ctx)`

Manually trigger compensation execution:

```typescript
await sagaInstance.Compensate(ctx);
```

## Usage Example

### Basic Compensation

```typescript
@Injectable()
export class OrderStateMachine extends BusTransitStateMachine<OrderState> {

    ProcessingPayment = new SagaState('ProcessingPayment');
    ReservingInventory = new SagaState('ReservingInventory');
    Completed = new SagaState('Completed');
    Failed = new SagaState('Failed');

    OrderSubmitted = new SagaEvent(OrderSubmitted);
    PaymentProcessed = new SagaEvent(PaymentProcessed);
    InventoryReserved = new SagaEvent(InventoryReserved);
    OrderFailed = new SagaEvent(OrderFailed);

    constructor() {
        super(OrderState);

        // Define events with correlations
        this.Event(this.OrderSubmitted, x => x.CorrelateById(m => m.Message.OrderId));
        this.Event(this.PaymentProcessed, x => x.CorrelateById(m => m.Message.OrderId));
        this.Event(this.InventoryReserved, x => x.CorrelateById(m => m.Message.OrderId));
        this.Event(this.OrderFailed, x => x.CorrelateById(m => m.Message.OrderId));

        // Step 1: Submit Order and Process Payment
        this.Initially(
            this.When(OrderSubmitted)
                .Then(c => {
                    c.Saga.OrderTotal = c.Message.Total;
                    c.Saga.CustomerEmail = c.Message.Email;
                    c.Saga.OrderDate = new Date();
                })
                .PublishAsync<ProcessPayment>(ProcessPayment, c => {
                    let processPayment = new ProcessPayment();
                    processPayment.OrderId = c.Saga.CorrelationId;
                    processPayment.Amount = c.Saga.OrderTotal;
                    return processPayment;
                })
                .TransitionTo(this.ProcessingPayment)
        );

        // Step 2: Payment Processed - Reserve Inventory
        this.During(this.ProcessingPayment, [
            this.When(PaymentProcessed)
                .Then(c => {
                    c.Saga.PaymentIntentId = c.Message.PaymentIntentId;
                })
                .PublishAsync<ReserveInventory>(ReserveInventory, c => {
                    let reserveInventory = new ReserveInventory();
                    reserveInventory.OrderId = c.Saga.CorrelationId;
                    return reserveInventory;
                })
                // Define compensation for payment processing
                .Compensate(async c => {
                    // Refund the payment
                    let refundPayment = new RefundPayment();
                    refundPayment.OrderId = c.Saga.CorrelationId;
                    refundPayment.PaymentIntentId = c.Saga.PaymentIntentId;
                    refundPayment.Amount = c.Saga.OrderTotal;

                    await c.producerClient.Send(refundPayment, c);
                    Logger.log(`[COMPENSATION] Refunded payment for order ${c.Saga.CorrelationId}`);
                })
                .TransitionTo(this.ReservingInventory),

            // Handle failure during payment
            this.When(OrderFailed)
                .Then(async c => {
                    // Automatically compensate previous steps
                    await this.Compensate(c);
                })
                .TransitionTo(this.Failed)
                .Finalize()
        ]);

        // Step 3: Inventory Reserved - Complete Order
        this.During(this.ReservingInventory, [
            this.When(InventoryReserved)
                .PublishAsync<OrderConfirmed>(OrderConfirmed, c => {
                    let orderConfirmed = new OrderConfirmed();
                    orderConfirmed.OrderId = c.Saga.CorrelationId;
                    return orderConfirmed;
                })
                // Define compensation for inventory reservation
                .Compensate(async c => {
                    // Release the inventory
                    let releaseInventory = new ReleaseInventory();
                    releaseInventory.OrderId = c.Saga.CorrelationId;

                    await c.producerClient.Send(releaseInventory, c);
                    Logger.log(`[COMPENSATION] Released inventory for order ${c.Saga.CorrelationId}`);
                })
                .TransitionTo(this.Completed)
                .Finalize(),

            // Handle failure during inventory reservation
            this.When(OrderFailed)
                .Then(async c => {
                    // Automatically compensate all previous steps (inventory + payment)
                    await this.Compensate(c);
                })
                .TransitionTo(this.Failed)
                .Finalize()
        ]);

        this.SetCompletedWhenFinalized(c => {
            Logger.log(`Saga completed for order ${c.Saga.CorrelationId}`);
        });
    }
}
```

## How It Works

### 1. Tracking Compensation Activities

When a saga step executes and has a compensation action defined, the library automatically tracks it:

```typescript
{
    eventName: "PaymentProcessed",
    stateName: "ReservingInventory",
    compensationData: { /* original message data */ },
    timestamp: Date
}
```

These activities are stored in the saga state: `ctx.Saga.CompensationActivities[]`

### 2. Executing Compensations

When you call `await this.Compensate(ctx)`, the library:

1. Reverses the order of compensation activities (LIFO)
2. Executes each compensation action in reverse order
3. Provides the original message data to each compensation
4. Logs all compensation steps
5. Clears the compensation activities list

### 3. Compensation Flow Example

For the order processing saga above:

**Success Flow:**
1. OrderSubmitted → ProcessPayment
2. PaymentProcessed → ReserveInventory (tracked for compensation)
3. InventoryReserved → OrderConfirmed (tracked for compensation)
4. Completed ✓

**Failure Flow:**
1. OrderSubmitted → ProcessPayment
2. PaymentProcessed → ReserveInventory (tracked for compensation)
3. OrderFailed → Triggers compensation
4. Compensation executes in reverse:
   - Release Inventory (step 2 compensation)
   - Refund Payment (step 1 compensation)
5. Failed state with all compensations completed

## Best Practices

1. **Define compensations for all side effects**: Any step that changes external state should have a compensation

2. **Keep compensations idempotent**: Compensations may be retried, so ensure they can be safely executed multiple times

3. **Log compensation activities**: Use detailed logging to track compensation execution

4. **Handle compensation failures**: Consider what happens if a compensation itself fails

5. **Use compensation data**: The original message data is available in compensations via `ctx.Message`

## Saga State Properties

The `SagaStateMachineInstance` now includes:

- `CompensationActivities: ICompensationActivity[]` - List of tracked compensation activities
- `IsCompensating: boolean` - Flag indicating if compensation is in progress

## Compensation Activity Interface

```typescript
interface ICompensationActivity {
    eventName: string;        // Name of the event that was compensated
    stateName: string;        // State when the activity was tracked
    compensationData?: any;   // Original message data
    timestamp: Date;          // When the activity was tracked
}
```

## Advanced Usage

### Manual Compensation Triggers

You can trigger compensation at any point in your saga:

```typescript
this.When(SomeEvent)
    .Then(async c => {
        if (someCondition) {
            // Manually trigger compensation
            await this.Compensate(c);
            return;
        }
        // Continue normal flow
    })
```

### Conditional Compensation

```typescript
.Compensate(async c => {
    // Only compensate if certain conditions are met
    if (c.Saga.PaymentIntentId) {
        await refundPayment(c.Saga.PaymentIntentId);
    }
})
```

### Compensation with External Services

```typescript
.Compensate(async c => {
    try {
        // Call external service to undo the action
        await externalService.rollback(c.Saga.CorrelationId);
        Logger.log(`Compensated external service for ${c.Saga.CorrelationId}`);
    } catch (error) {
        Logger.error(`Compensation failed: ${error.message}`);
        // Handle compensation failure
        throw error;
    }
})
```
