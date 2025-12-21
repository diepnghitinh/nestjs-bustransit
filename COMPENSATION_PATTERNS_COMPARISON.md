# Compensation Patterns Comparison

This guide compares the two compensation patterns available in the NestJS BusTransit library: **Saga Compensation** and **Routing Slips**.

## Quick Comparison

| Aspect | Saga Compensation | Routing Slips |
|--------|------------------|---------------|
| **Pattern Type** | Event-driven state machine | Activity-based orchestration |
| **Coupling** | Tight to saga definition | Loose - reusable activities |
| **Compensation Trigger** | Manual (`await this.Compensate(ctx)`) | Automatic on activity fault |
| **State Management** | Persistent saga state | Routing slip document |
| **Best For** | Long-running business processes | Multi-service workflows |
| **Reusability** | Low - tied to specific saga | High - activities reused across workflows |
| **Complexity** | Higher - state machine + events | Lower - sequential activity execution |
| **Dynamic Behavior** | Fixed state transitions | Dynamic itinerary at runtime |
| **Learning Curve** | Steeper | Gentler |

## When to Use Each Pattern

### Use Saga Compensation When:

✅ **Complex Business Processes**
- Multiple state transitions
- Conditional branches based on saga state
- Complex business rules and validations

✅ **Long-Running Processes**
- Processes that span days or weeks
- Need to persist state between steps
- May pause and resume execution

✅ **Event-Driven Architecture**
- Services communicate via events
- Each service publishes/subscribes to events
- Existing event-driven infrastructure

✅ **Rich State Management**
- Need to track complex saga state
- State influences multiple decisions
- State queried by other parts of system

**Example Use Cases**:
- Order fulfillment with approval workflows
- Loan application processing
- Insurance claim processing
- Multi-tenant onboarding flows

### Use Routing Slips When:

✅ **Multi-Service Coordination**
- Workflow spans multiple independent services
- Services don't need to know about each other
- Clear sequence of operations

✅ **Reusable Workflows**
- Same activities used in different contexts
- Need to mix and match activities
- Build workflows dynamically

✅ **Short-Lived Workflows**
- Completes in minutes or hours
- All steps execute in one go
- No pausing/resuming needed

✅ **Clear Compensation Logic**
- Each step has obvious undo operation
- Compensations are independent
- No complex state dependencies

**Example Use Cases**:
- Order processing (payment → inventory → shipping)
- Data transformation pipelines
- Multi-step API integrations
- Batch processing workflows

## Detailed Comparison

### 1. Architecture

#### Saga Compensation Architecture

```
┌─────────────────────────────────────────────────┐
│ Saga State Machine                              │
│                                                 │
│  States:                                        │
│  ├─ Initial                                     │
│  ├─ ProcessingPayment                           │
│  ├─ ReservingInventory                          │
│  ├─ Completed                                   │
│  └─ Failed                                      │
│                                                 │
│  Events:                                        │
│  ├─ OrderSubmitted ──→ ProcessingPayment        │
│  ├─ PaymentProcessed ──→ ReservingInventory     │
│  ├─ InventoryReserved ──→ Completed             │
│  └─ OrderFailed ──→ Trigger Compensation        │
│                                                 │
│  Compensation Actions:                          │
│  ├─ Defined per event/state transition         │
│  └─ Manually triggered via Compensate(ctx)     │
└─────────────────────────────────────────────────┘
         │                                  ▲
         │ Publishes Events                 │ Subscribes to Events
         ▼                                  │
┌─────────────────────────────────────────────────┐
│ External Services (via Message Bus)            │
│ ├─ Payment Service                              │
│ ├─ Inventory Service                            │
│ └─ Shipping Service                             │
└─────────────────────────────────────────────────┘
```

#### Routing Slips Architecture

```
┌─────────────────────────────────────────────────┐
│ Routing Slip Builder                            │
│  Creates routing slip document with:            │
│  ├─ Tracking number                             │
│  ├─ Itinerary [Activity₁, Activity₂, ...]      │
│  └─ Variables {key: value, ...}                 │
└─────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────┐
│ Routing Slip Executor                           │
│  Executes activities sequentially:              │
│  1. Create execute context                      │
│  2. Run activity.execute()                      │
│  3. Handle result (Complete/Fault/Terminate)    │
│  4. On Fault: Auto-trigger compensation         │
└─────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────┐
│ Activities (via Activity Factory)               │
│ ├─ ProcessPaymentActivity                       │
│ │   ├─ execute()                                │
│ │   └─ compensate()                             │
│ ├─ ReserveInventoryActivity                     │
│ │   ├─ execute()                                │
│ │   └─ compensate()                             │
│ └─ SendConfirmationActivity                     │
│     └─ execute() (no compensation)              │
└─────────────────────────────────────────────────┘
```

### 2. Code Examples

#### Saga Compensation Example

```typescript
@Injectable()
export class OrderStateMachine extends BusTransitStateMachine<OrderState> {
    // Define states
    ProcessingPayment = new SagaState('ProcessingPayment');
    ReservingInventory = new SagaState('ReservingInventory');
    Completed = new SagaState('Completed');
    Failed = new SagaState('Failed');

    // Define events
    OrderSubmitted = new SagaEvent(OrderSubmitted);
    PaymentProcessed = new SagaEvent(PaymentProcessed);
    OrderFailed = new SagaEvent(OrderFailed);

    constructor() {
        super(OrderState);

        // Configure event correlations
        this.Event(this.OrderSubmitted, x => x.CorrelateById(m => m.Message.OrderId));
        this.Event(this.PaymentProcessed, x => x.CorrelateById(m => m.Message.OrderId));
        this.Event(this.OrderFailed, x => x.CorrelateById(m => m.Message.OrderId));

        // Define workflow
        this.Initially(
            this.When(OrderSubmitted)
                .Then(c => {
                    c.Saga.OrderTotal = c.Message.Total;
                })
                .PublishAsync<ProcessPayment>(ProcessPayment, c => {
                    return new ProcessPayment(c.Saga.CorrelationId, c.Saga.OrderTotal);
                })
                .TransitionTo(this.ProcessingPayment)
        );

        this.During(this.ProcessingPayment, [
            this.When(PaymentProcessed)
                .Then(c => {
                    c.Saga.PaymentIntentId = c.Message.PaymentIntentId;
                })
                .PublishAsync<ReserveInventory>(ReserveInventory, c => {
                    return new ReserveInventory(c.Saga.CorrelationId);
                })
                // Define compensation
                .Compensate(async c => {
                    // Refund payment
                    await c.producerClient.Send(
                        new RefundPayment(c.Saga.PaymentIntentId),
                        c
                    );
                })
                .TransitionTo(this.ReservingInventory),

            // Handle failure - MANUAL trigger
            this.When(OrderFailed)
                .Then(async c => {
                    await this.Compensate(c); // Manual trigger
                })
                .TransitionTo(this.Failed)
                .Finalize()
        ]);
    }
}
```

**Key Points**:
- Event-driven state transitions
- Compensation defined inline with workflow
- Manual compensation trigger
- State persisted in saga instance
- Tight coupling between events and compensations

#### Routing Slips Example

```typescript
// 1. Define reusable activity
@Injectable()
export class ProcessPaymentActivity implements IActivity<PaymentArgs, PaymentLog> {
    name = 'ProcessPayment';

    async execute(context: IExecuteContext<PaymentArgs>): Promise<IActivityResult> {
        try {
            const paymentId = await this.paymentService.charge(
                context.arguments.amount
            );

            const variables = new Map(context.variables);
            variables.set('paymentIntentId', paymentId);

            return context.completedWithVariables(variables, {
                paymentIntentId: paymentId,
                amount: context.arguments.amount
            });
        } catch (error) {
            return context.faulted(error); // Auto-triggers compensation
        }
    }

    async compensate(context: ICompensateContext<PaymentLog>): Promise<void> {
        await this.paymentService.refund(
            context.compensationLog.paymentIntentId
        );
    }
}

// 2. Build and execute routing slip
const routingSlip = RoutingSlipBuilder.create('order-123')
    .addActivity('ProcessPayment', 'payment', {
        orderId: 'order-123',
        amount: 99.99
    })
    .addActivity('ReserveInventory', 'inventory', {
        orderId: 'order-123',
        items: [...]
    })
    .build();

const executor = new RoutingSlipExecutor(activityFactory);
await executor.execute(routingSlip); // Automatic compensation on fault
```

**Key Points**:
- Activity-based, not event-driven
- Activities are reusable across different routing slips
- Automatic compensation on activity fault
- No persistent state machine
- Loose coupling between activities

### 3. Compensation Execution

#### Saga Compensation Flow

```typescript
// 1. Define compensations inline with workflow
this.When(PaymentProcessed)
    .Then(c => { /* forward logic */ })
    .Compensate(async c => { /* compensation logic */ })
    .TransitionTo(this.NextState)

// 2. Track compensations automatically as events occur
// (stored in ctx.Saga.CompensationActivities)

// 3. Manually trigger compensation when needed
this.When(OrderFailed)
    .Then(async c => {
        await this.Compensate(c); // Explicit call
    })
    .TransitionTo(this.Failed)

// 4. Compensations execute in reverse order (LIFO)
// Using stored compensation activities
```

**Characteristics**:
- Compensation tied to event/state transitions
- Manual trigger required
- Part of saga state machine definition
- Compensations stored in saga state

#### Routing Slips Compensation Flow

```typescript
// 1. Define compensation in activity class
class ProcessPaymentActivity implements IActivity<Args, Log> {
    async execute(context) {
        // Execute logic
        return context.completed(compensationLog);
    }

    async compensate(context) {
        // Compensation logic
    }
}

// 2. Execute activity - compensation log stored automatically
await activity.execute(context);
// Executor stores: { activityName, compensationLog, timestamp }

// 3. On fault - compensation triggers AUTOMATICALLY
await someActivity.execute(context);
// Returns: context.faulted(error)
// → Executor automatically compensates all previous activities

// 4. Compensations execute in reverse order (LIFO)
// Using stored activity logs
```

**Characteristics**:
- Compensation built into activity
- Automatic trigger on fault
- Self-contained in activity class
- Compensations stored in routing slip logs

### 4. State Management

#### Saga Compensation State

```typescript
// Saga state persisted across events
class OrderState extends SagaStateMachineInstance {
    OrderId: string;
    CustomerEmail: string;
    OrderTotal: number;
    PaymentIntentId?: string;
    ReservationId?: string;

    // Saga-specific fields
    CurrentState: string;
    CorrelationId: string;
    CompensationActivities: ICompensationActivity[];
    IsCompensating: boolean;
}

// State persists between events
// Can query saga state at any time
// State machine knows where it is in the process
```

**Characteristics**:
- Rich state object
- Persists between events
- Can be queried/updated at any time
- Supports long-running processes

#### Routing Slips State

```typescript
// Routing slip document (short-lived)
interface IRoutingSlip {
    trackingNumber: string;
    itinerary: IRoutingSlipActivity[];
    variables: Map<string, any>;  // Simple key-value store
    activityLogs: IActivityLog[];
    activityExceptions: IActivityException[];
}

// Minimal state - just enough for execution
// Not designed for long-term persistence
// Completes in one execution
```

**Characteristics**:
- Lightweight document
- Variables instead of rich state
- Short-lived (execution duration only)
- Not designed for persistence

### 5. Flexibility and Extensibility

#### Saga Compensation

```typescript
// Fixed state machine - changes require code updates
this.Initially(
    this.When(OrderSubmitted)
        .Then(...)
        .TransitionTo(this.ProcessingPayment)
);

this.During(this.ProcessingPayment, [
    this.When(PaymentProcessed)
        .Then(...)
        .TransitionTo(this.ReservingInventory)
]);

// Adding a new step requires:
// 1. New state
// 2. New event
// 3. New transition
// 4. Update state machine definition
```

**Flexibility**: Low - Fixed state machine

#### Routing Slips

```typescript
// Dynamic itinerary - build at runtime
const builder = RoutingSlipBuilder.create(orderId);

// Base activities
builder.addActivity('ProcessPayment', 'payment', paymentArgs);

// Conditional activities
if (order.isInternational) {
    builder.addActivity('CheckCustoms', 'customs', customsArgs);
    builder.addActivity('CalculateDuties', 'tax', taxArgs);
}

// Add more activities
builder.addActivity('Ship', 'shipping', shippingArgs);

const routingSlip = builder.build();

// Activities are reusable across different routing slips
```

**Flexibility**: High - Dynamic composition

### 6. Error Handling

#### Saga Compensation

```typescript
// Error handling at state level
this.During(this.ProcessingPayment, [
    this.When(PaymentProcessed)
        .Then(c => { /* ... */ })
        .Compensate(async c => { /* ... */ })
        .TransitionTo(this.ReservingInventory),

    // Explicit error event
    this.When(PaymentFailed)
        .Then(async c => {
            await this.Compensate(c);
        })
        .TransitionTo(this.Failed)
]);

// Requires explicit error events
// Error handling tied to state machine
```

#### Routing Slips

```typescript
// Error handling at activity level
async execute(context: IExecuteContext<Args>): Promise<IActivityResult> {
    try {
        const result = await this.doWork(context.arguments);
        return context.completed(result);
    } catch (error) {
        // Activity decides how to handle error
        if (error.retryable) {
            // Could retry here
        }
        return context.faulted(error); // Triggers automatic compensation
    }
}

// Automatic compensation on fault
// No explicit error events needed
```

### 7. Testing

#### Saga Compensation Testing

```typescript
describe('OrderStateMachine', () => {
    it('should compensate on payment failure', async () => {
        const stateMachine = new OrderStateMachine();
        const ctx = createMockContext();

        // 1. Submit order
        await stateMachine.Consume(createContext(new OrderSubmitted()), ...);
        expect(ctx.Saga.CurrentState).toBe('ProcessingPayment');

        // 2. Process payment
        await stateMachine.Consume(createContext(new PaymentProcessed()), ...);
        expect(ctx.Saga.CurrentState).toBe('ReservingInventory');

        // 3. Fail order
        await stateMachine.Consume(createContext(new OrderFailed()), ...);
        expect(ctx.Saga.CurrentState).toBe('Failed');
        expect(ctx.Saga.CompensationActivities).toHaveLength(0); // Compensated
    });
});

// Testing requires:
// - Mock entire state machine
// - Simulate event flow
// - Complex context setup
```

#### Routing Slips Testing

```typescript
describe('ProcessPaymentActivity', () => {
    it('should charge payment and store ID', async () => {
        const activity = new ProcessPaymentActivity(mockPaymentService);
        const context = createExecuteContext({
            trackingNumber: 'test-123',
            arguments: { amount: 99.99 },
            variables: new Map()
        });

        const result = await activity.execute(context);

        expect(result.resultType).toBe(ActivityResultType.Complete);
        expect(result.variables.get('paymentIntentId')).toBeDefined();
    });

    it('should refund payment on compensation', async () => {
        const activity = new ProcessPaymentActivity(mockPaymentService);
        const context = createCompensateContext({
            trackingNumber: 'test-123',
            compensationLog: { paymentIntentId: 'pi_123', amount: 99.99 }
        });

        await activity.compensate(context);

        expect(mockPaymentService.refund).toHaveBeenCalledWith('pi_123');
    });
});

// Testing is simpler:
// - Test activities in isolation
// - Simple context creation
// - No state machine setup needed
```

## Migration Guide

### From Saga Compensation to Routing Slips

If you have an existing saga with compensation and want to migrate to routing slips:

**Before (Saga Compensation)**:
```typescript
this.During(this.ProcessingPayment, [
    this.When(PaymentProcessed)
        .Then(c => {
            c.Saga.PaymentIntentId = c.Message.PaymentIntentId;
        })
        .PublishAsync<ReserveInventory>(ReserveInventory, c => {
            return new ReserveInventory(c.Saga.CorrelationId);
        })
        .Compensate(async c => {
            await refundPayment(c.Saga.PaymentIntentId);
        })
        .TransitionTo(this.ReservingInventory)
]);
```

**After (Routing Slips)**:
```typescript
// 1. Extract to activity
@Injectable()
class ProcessPaymentActivity implements IActivity<PaymentArgs, PaymentLog> {
    async execute(context) {
        const paymentId = await this.processPayment(context.arguments);
        return context.completedWithVariables(
            new Map([['paymentIntentId', paymentId]]),
            { paymentIntentId: paymentId, amount: context.arguments.amount }
        );
    }

    async compensate(context) {
        await refundPayment(context.compensationLog.paymentIntentId);
    }
}

// 2. Use in routing slip
const routingSlip = RoutingSlipBuilder.create(orderId)
    .addActivity('ProcessPayment', 'payment', { amount: 99.99 })
    .addActivity('ReserveInventory', 'inventory', { items: [...] })
    .build();

await executor.execute(routingSlip);
```

### From Routing Slips to Saga Compensation

If you need more complex state management:

**Before (Routing Slips)**:
```typescript
const routingSlip = RoutingSlipBuilder.create(orderId)
    .addActivity('ProcessPayment', 'payment', args)
    .addActivity('ReserveInventory', 'inventory', args)
    .build();
```

**After (Saga Compensation)**:
```typescript
// Create saga state machine with rich state
class OrderStateMachine extends BusTransitStateMachine<OrderState> {
    // Define states, events, and transitions
    // Add compensation logic to each step
}

// Benefits: Persistent state, complex workflows, event-driven
```

## Choosing the Right Pattern

### Decision Tree

```
Do you need long-running processes (days/weeks)?
├─ YES → Use Saga Compensation
│         - Need persistent state
│         - May pause/resume
│         - Complex business logic
│
└─ NO → Is your workflow event-driven?
        ├─ YES → Use Saga Compensation
        │         - Services publish/subscribe events
        │         - Existing event infrastructure
        │         - Complex state transitions
        │
        └─ NO → Do you need reusable activities?
                ├─ YES → Use Routing Slips
                │         - Activities used across workflows
                │         - Dynamic composition
                │         - Multi-service coordination
                │
                └─ MAYBE → Is compensation complex?
                          ├─ Complex → Use Saga Compensation
                          │            - State-dependent compensation
                          │            - Multiple compensation paths
                          │
                          └─ Simple → Use Routing Slips
                                      - Clear undo operations
                                      - Independent compensations
```

### Recommendation Summary

**Use Saga Compensation for**:
- Order fulfillment with approval workflows
- Long-running business processes
- Complex state management needs
- Event-driven architectures
- Processes that may pause/resume

**Use Routing Slips for**:
- Payment → Inventory → Shipping workflows
- Data transformation pipelines
- Multi-service API orchestration
- Batch processing
- Dynamic workflow composition

## Conclusion

Both patterns are powerful tools for managing distributed transactions with compensation:

- **Saga Compensation**: Best for complex, long-running, event-driven business processes
- **Routing Slips**: Best for coordinating multi-service workflows with reusable activities

Choose based on your specific requirements:
- Need persistent state? → Saga Compensation
- Need reusable activities? → Routing Slips
- Event-driven architecture? → Saga Compensation
- Short-lived workflows? → Routing Slips

Both patterns are available in this library and can coexist in the same application!
