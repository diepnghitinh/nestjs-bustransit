# Hybrid Pattern: Saga + Routing Slips

This directory contains an example implementation combining the Saga pattern with Routing Slips.

## Quick Overview

### Pattern Combination

**Saga Pattern** (High-level orchestration)
- Manages business workflow states
- Coordinates multiple services
- Long-running transaction management

**Routing Slips Pattern** (Detailed operations)
- Multi-step activity execution
- Fine-grained compensation (LIFO)
- Automatic rollback on failure

### Architecture

```
Saga: OrderSubmitted → Fulfilling → Shipping → Completed
                            ↓
              Routing Slip: Pick → Pack → Label → QualityCheck
                            (each with compensation)
```

## Files in This Directory

### Core Saga
- **OrderFulfillmentSaga.ts** - Main saga state machine managing order fulfillment workflow

### Consumers
- **ExecuteFulfillmentConsumer.ts** - Executes routing slip for fulfillment (KEY INTEGRATION POINT)
- **ArrangeShippingConsumer.ts** - Handles shipping arrangement
- **NotifyCustomerConsumer.ts** - Sends customer notifications

### Services
- **HybridPatternService.ts** - Entry point to initiate the saga

### Routing Slip Activities
All activities support compensation:
- **PickItemsActivity.ts** - Pick items from warehouse
- **PackItemsActivity.ts** - Pack items into boxes
- **GenerateShippingLabelActivity.ts** - Create shipping label
- **QualityCheckActivity.ts** - Quality inspection (can fail for demo)

## How It Works

1. **Service initiates saga**
   ```typescript
   hybridPatternService.submitOrder(orderId, items, ...)
   ```

2. **Saga publishes ExecuteFulfillment command**
   ```
   State: Submitted → Fulfilling
   ```

3. **Consumer receives command and executes routing slip**
   ```typescript
   // ExecuteFulfillmentConsumer
   const routingSlip = routingSlipService.createBuilder(...)
       .addActivity('PickItems', ...)
       .addActivity('PackItems', ...)
       .addActivity('GenerateShippingLabel', ...)
       .addActivity('QualityCheck', ...)
       .build();

   await routingSlipService.execute(routingSlip);
   ```

4. **Routing slip executes activities**
   ```
   Pick → Pack → Label → QualityCheck
   (sharing data via variables)
   ```

5. **Consumer reports back to saga**
   ```typescript
   // Success
   await publishEndpoint.Send(new FulfillmentCompleted(...), ctx);

   // Or failure (after automatic compensation)
   await publishEndpoint.Send(new FulfillmentFailed(...), ctx);
   ```

6. **Saga transitions to next state**
   ```
   State: Fulfilling → Shipping → Completed
   ```

## Testing

### Run the example:
```bash
curl http://localhost:3000/test-hybrid-pattern
```

### Test compensation:
Modify `QualityCheckActivity` to fail:
```typescript
.addActivity('QualityCheck', 'quality-service', {
    shouldFail: true
})
```

Watch logs to see:
1. Activities execute: Pick → Pack → Label → QualityCheck (fails)
2. Compensation triggers: Label → Pack → Pick (reverse order)
3. Saga receives FulfillmentFailed event
4. Saga transitions to Failed state

## Key Integration Point

The **ExecuteFulfillmentConsumer** is where saga meets routing slip:

```typescript
@Injectable()
export class ExecuteFulfillmentConsumer extends BusTransitConsumer<ExecuteFulfillment> {
    constructor(
        private readonly publishEndpoint: IPublishEndpoint,
        private readonly routingSlipService: RoutingSlipService,
    ) {
        super(ExecuteFulfillment);
    }

    async Consume(ctx, context: ISagaConsumeContext<any, ExecuteFulfillment>) {
        try {
            // Execute routing slip
            const routingSlip = this.routingSlipService.createBuilder(...)...build();
            await this.routingSlipService.execute(routingSlip);

            // Report success to saga
            await this.publishEndpoint.Send(new FulfillmentCompleted(...), ctx);
        } catch (error) {
            // Routing slip already compensated
            // Report failure to saga
            await this.publishEndpoint.Send(new FulfillmentFailed(...), ctx);
        }
    }
}
```

## Benefits

✅ **Clear Separation**: Business logic (saga) vs operational details (routing slip)

✅ **Two-Level Compensation**:
- Routing slip: Automatic activity compensation
- Saga: Business-level compensation decisions

✅ **Maintainable**: Easy to add new activities or saga states

✅ **Scalable**: Can distribute activities across multiple services

✅ **Robust**: Handles failures at both levels gracefully

## When to Use

Use this pattern when:
- You have long-running workflows (saga)
- Some steps require complex multi-step operations (routing slip)
- You need fine-grained compensation for operational steps
- You want to separate business workflow from operational details

## Learn More

See [HYBRID_PATTERN_GUIDE.md](../../../HYBRID_PATTERN_GUIDE.md) for:
- Detailed architecture explanation
- Complete code examples
- Comparison with other patterns
- Best practices
- Testing strategies
