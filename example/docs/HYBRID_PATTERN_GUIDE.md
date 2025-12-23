# Hybrid Pattern: Combining Sagas and Routing Slips

This guide demonstrates how to combine the Saga pattern with Routing Slips to build robust, scalable distributed transactions in NestJS BusTransit.

## Table of Contents

- [Overview](#overview)
- [Why Combine Sagas and Routing Slips?](#why-combine-sagas-and-routing-slips)
- [Architecture](#architecture)
- [Implementation Example](#implementation-example)
- [Running the Example](#running-the-example)
- [Key Concepts](#key-concepts)
- [When to Use This Pattern](#when-to-use-this-pattern)

## Overview

The hybrid pattern combines two powerful distributed transaction patterns:

1. **Saga Pattern**: Manages high-level business workflow and state transitions
2. **Routing Slips Pattern**: Handles complex multi-step operations with fine-grained compensation

This approach provides:
- Clear separation between business workflow (saga) and operational details (routing slips)
- Long-running transaction coordination across multiple services
- Automatic compensation at both saga and routing slip levels
- Flexibility to mix simple operations with complex multi-step processes

## Why Combine Sagas and Routing Slips?

### Saga Pattern Alone
- ✅ Great for orchestrating high-level workflows
- ✅ Manages state across multiple services
- ❌ Can become complex when individual steps have multiple sub-steps
- ❌ Compensation logic can be scattered across multiple consumers

### Routing Slips Alone
- ✅ Perfect for multi-step operations with automatic compensation
- ✅ Clear activity chain with LIFO compensation
- ❌ Not ideal for long-running workflows with complex state management
- ❌ Limited state persistence across multiple routing slips

### Hybrid Approach (Best of Both)
- ✅ Saga manages overall business workflow and state
- ✅ Routing slips handle complex multi-step operations within saga steps
- ✅ Automatic compensation at both levels
- ✅ Clean separation of concerns
- ✅ Scalable and maintainable

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         SAGA LAYER                              │
│  (High-level workflow orchestration & state management)         │
│                                                                  │
│  States: Submitted → Fulfilling → Shipping → Completed          │
│                                                                  │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐     │
│  │ OrderSubmit  │ →  │   Execute    │ →  │   Arrange    │     │
│  │ tedFor       │    │  Fulfillment │    │   Shipping   │     │
│  │ Fulfillment  │    │              │    │              │     │
│  └──────────────┘    └──────┬───────┘    └──────────────┘     │
└─────────────────────────────┼─────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                   ROUTING SLIP LAYER                            │
│  (Multi-step operations with automatic compensation)            │
│                                                                  │
│  ┌────────────┐   ┌──────────┐   ┌──────────┐   ┌──────────┐  │
│  │ PickItems  │ → │   Pack   │ → │  Generate│ → │ Quality  │  │
│  │            │   │  Items   │   │  Label   │   │  Check   │  │
│  │ ✓ Compensate   │ ✓ Compensate  │ ✓ Compensate  │ ✓ Compensate │
│  └────────────┘   └──────────┘   └──────────┘   └──────────┘  │
│                                                                  │
│  Result: FulfillmentCompleted or FulfillmentFailed              │
└─────────────────────────────────────────────────────────────────┘
```

## Implementation Example

### 1. Saga State Machine

The saga manages the overall order fulfillment workflow:

```typescript
// OrderFulfillmentSaga.ts
@Injectable()
export class OrderFulfillmentSaga extends BusTransitStateMachine<OrderFulfillmentState> {
    ProcessingOrder = new SagaState('ProcessingOrder');
    FulfillingOrder = new SagaState('FulfillingOrder');
    ArrangingShipping = new SagaState('ArrangingShipping');
    Completed = new SagaState('Completed');

    constructor() {
        super(OrderFulfillmentState);

        // When order is submitted, trigger fulfillment
        this.Initially(
            this.When(OrderSubmittedForFulfillment)
                .PublishAsync<ExecuteFulfillment>(ExecuteFulfillment, c => {
                    // This triggers the routing slip
                    return new ExecuteFulfillment(c.Saga.OrderId, c.Saga.Items);
                })
                .TransitionTo(this.FulfillingOrder)
        );

        // Handle fulfillment result
        this.During(this.FulfillingOrder, [
            this.When(FulfillmentCompleted)
                .PublishAsync<ArrangeShipping>(ArrangeShipping, ...)
                .TransitionTo(this.ArrangingShipping),

            this.When(FulfillmentFailed)
                .TransitionTo(this.Failed)
                .Finalize()
        ]);
    }
}
```

### 2. Consumer with Routing Slip

The consumer receives the saga command and executes a routing slip:

```typescript
// ExecuteFulfillmentConsumer.ts
@Injectable()
export class ExecuteFulfillmentConsumer extends BusTransitConsumer<ExecuteFulfillment> {
    constructor(
        private readonly publishEndpoint: IPublishEndpoint,
        private readonly routingSlipService: RoutingSlipService,
    ) {
        super(ExecuteFulfillment);
    }

    async Consume(ctx, context: ISagaConsumeContext<any, ExecuteFulfillment>): Promise<any> {
        try {
            // Build routing slip with multiple activities
            const routingSlip = this.routingSlipService.createBuilder(...)
                .addActivity('PickItems', 'warehouse-service', {...})
                .addActivity('PackItems', 'warehouse-service', {...})
                .addActivity('GenerateShippingLabel', 'shipping-service', {...})
                .addActivity('QualityCheck', 'quality-service', {...})
                .build();

            // Execute routing slip
            await this.routingSlipService.execute(routingSlip);

            // Report success to saga
            const success = new FulfillmentCompleted();
            success.OrderId = context.Message.OrderId;
            success.FulfillmentId = routingSlip.variables.get('packageId');
            await this.publishEndpoint.Send(success, ctx);

        } catch (error) {
            // Routing slip already compensated all activities
            // Report failure to saga
            const failure = new FulfillmentFailed();
            failure.OrderId = context.Message.OrderId;
            failure.Reason = error.message;
            await this.publishEndpoint.Send(failure, ctx);
        }
    }
}
```

### 3. Routing Slip Activities

Each activity in the routing slip supports compensation:

```typescript
// PickItemsActivity.ts
@RoutingSlipActivity({ name: 'PickItems' })
@Injectable()
export class PickItemsActivity implements IActivity<PickItemsArguments, PickItemsLog> {
    async execute(context: IExecuteContext<PickItemsArguments>): Promise<IActivityResult> {
        // Pick items from warehouse
        const pickedItems = await this.pickFromWarehouse(context.args.items);

        // Store data for next activities
        const variables = new Map(context.variables);
        variables.set('pickedItems', pickedItems);

        return context.completedWithVariables(variables, compensationLog);
    }

    async compensate(context: ICompensateContext<PickItemsLog>): Promise<void> {
        // Return items to warehouse shelves
        await this.returnToWarehouse(context.compensationLog.items);
    }
}
```

## Running the Example

### 1. Start the Application

```bash
cd example
npm install
npm run start:dev
```

### 2. Test the Hybrid Pattern

```bash
# Test successful flow
curl http://localhost:3000/test-hybrid-pattern
```

### 3. Observe the Logs

You'll see:

1. **Saga State Transitions**
   ```
   [OrderFulfillmentSaga] Order submitted: xxx
   [OrderFulfillmentSaga] Publishing ExecuteFulfillment command
   ```

2. **Routing Slip Execution**
   ```
   [ExecuteFulfillmentConsumer] Using routing slip to execute fulfillment
   [PickItems] Picking items for order xxx
   [PackItems] Packing items for order xxx
   [GenerateShippingLabel] Generating label for order xxx
   [QualityCheck] Quality check passed
   ```

3. **Saga Continuation**
   ```
   [OrderFulfillmentSaga] Fulfillment completed: xxx
   [OrderFulfillmentSaga] Publishing ArrangeShipping command
   ```

### 4. Test Compensation

Modify `QualityCheckActivity.ts` to simulate failure:

```typescript
.addActivity('QualityCheck', 'quality-service', {
    orderId: context.Message.OrderId,
    shouldFail: true  // Force failure
})
```

You'll see compensation in reverse order:
```
[QualityCheck] Quality check failed
[GenerateShippingLabel] Compensating label: voiding tracking number
[PackItems] Compensating package: unpacking
[PickItems] Compensating: returning items to warehouse
[OrderFulfillmentSaga] Fulfillment failed - saga moved to Failed state
```

## Key Concepts

### 1. Separation of Concerns

```
┌─────────────────────────────────────┐
│ SAGA: "What should happen?"         │
│ - Order lifecycle states            │
│ - Business decisions                │
│ - Service coordination               │
└─────────────────────────────────────┘
                ↓
┌─────────────────────────────────────┐
│ ROUTING SLIP: "How to do it?"       │
│ - Detailed operational steps        │
│ - Activity execution order          │
│ - Fine-grained compensation         │
└─────────────────────────────────────┘
```

### 2. Two-Level Compensation

- **Routing Slip Level**: Automatically compensates failed activities (LIFO)
- **Saga Level**: Can trigger additional compensations or rollbacks

### 3. State Management

- **Saga**: Persists long-running workflow state
- **Routing Slip**: Shares transient state between activities via variables

### 4. Error Handling

```typescript
// Consumer bridges saga and routing slip error handling
try {
    await this.routingSlipService.execute(routingSlip);
    // Success → publish FulfillmentCompleted
} catch (error) {
    // Routing slip already compensated
    // Saga can decide: retry, abort, or alternate path
    // Publish FulfillmentFailed
}
```

## When to Use This Pattern

### ✅ Use Hybrid Pattern When:

1. **Long-running workflows with complex steps**
   - Example: Order fulfillment with multiple warehouses and shipping carriers

2. **Mixed complexity operations**
   - Some saga steps are simple (send email)
   - Others are complex (multi-step fulfillment)

3. **Need both levels of compensation**
   - Fine-grained: Routing slip compensates operational steps
   - Coarse-grained: Saga compensates business decisions

4. **Cross-service coordination with detailed operations**
   - Saga coordinates services
   - Routing slips coordinate activities within a service

### ❌ Don't Use Hybrid Pattern When:

1. **Simple workflows with no complex steps**
   - Use saga alone or simple message passing

2. **All steps are equally complex**
   - Use routing slips alone

3. **No compensation needed**
   - Use simple event-driven architecture

## File Structure

```
src/infrastructure/messaging/
├── hybrid/                                  # Hybrid pattern implementation
│   ├── OrderFulfillmentSaga.ts             # Saga state machine
│   ├── ExecuteFulfillmentConsumer.ts       # Consumer using routing slip
│   ├── ArrangeShippingConsumer.ts          # Simple consumer
│   ├── NotifyCustomerConsumer.ts           # Notification consumer
│   ├── HybridPatternService.ts             # Service to initiate saga
│   └── activities/                          # Routing slip activities
│       ├── PickItemsActivity.ts
│       ├── PackItemsActivity.ts
│       ├── GenerateShippingLabelActivity.ts
│       └── QualityCheckActivity.ts
├── sagas/                                   # Saga-only examples
└── routing-slips/                           # Routing slip-only examples
```

## Benefits Summary

| Feature | Saga Only | Routing Slip Only | Hybrid |
|---------|-----------|------------------|--------|
| Workflow orchestration | ✅ | ❌ | ✅ |
| State persistence | ✅ | ❌ | ✅ |
| Fine-grained compensation | ❌ | ✅ | ✅ |
| Complex multi-step operations | ⚠️ | ✅ | ✅ |
| Clear separation of concerns | ⚠️ | ⚠️ | ✅ |
| Maintainability | ⚠️ | ⚠️ | ✅ |

## Best Practices

1. **Keep sagas focused on business workflow**
   - Don't put operational details in saga
   - Use routing slips for complex operations

2. **Design activities to be idempotent**
   - Activities may be retried
   - Compensation should be safe to call multiple times

3. **Use clear naming**
   - Saga events: Business-focused (OrderSubmitted, FulfillmentCompleted)
   - Activity names: Operation-focused (PickItems, PackItems)

4. **Monitor both levels**
   - Subscribe to saga events
   - Subscribe to routing slip events
   - Implement comprehensive logging

5. **Test compensation paths**
   - Verify routing slip compensation
   - Verify saga transitions on failure
   - Test partial failures at different steps

## Conclusion

The hybrid pattern combines the strengths of both sagas and routing slips:
- **Sagas** provide workflow orchestration and state management
- **Routing slips** provide operational detail and automatic compensation
- Together they create a powerful, maintainable distributed transaction pattern

For more examples, see:
- `src/infrastructure/messaging/sagas/` - Saga pattern examples
- `src/infrastructure/messaging/routing-slips/` - Routing slip examples
- `src/infrastructure/messaging/hybrid/` - Hybrid pattern implementation
