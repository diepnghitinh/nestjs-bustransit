# Routing Slips Pattern

This library implements the **Routing Slips Pattern** for distributed transaction coordination, based on [MassTransit's Routing Slips](https://masstransit.io/documentation/concepts/routing-slips) concept.

## Quick Links

- 📖 **[Routing Slips Concepts](./ROUTING_SLIPS_CONCEPTS.md)** - Deep dive into the pattern, design, and how it works
- 📚 **[Saga Compensation](./COMPENSATION.md)** - Alternative event-driven compensation pattern

## Overview

Routing slips provide a way to coordinate distributed transactions across multiple services using an activity-based approach with automatic compensation on failure.

**Think of it like**: A routing slip is like a todo list that travels through multiple services, with each service checking off their task. If any task fails, all completed tasks are automatically undone in reverse order.

### Key Concepts

**Routing Slip**: A document containing an itinerary of activities to execute, variables to pass between activities, and tracking information.

**Activity**: A processing step that can execute business logic and optionally support compensation (undo).

**Itinerary**: An ordered list of activities to execute sequentially.

**Variables**: Key-value data passed between activities and available during execution and compensation.

**Compensation**: The process of undoing completed activities when a later activity fails (executed in reverse order - LIFO).

## Routing Slips vs Saga Compensation

| Feature | Routing Slips | Saga Compensation |
|---------|--------------|-------------------|
| **Pattern** | Activity-based workflow | Event-driven state machine |
| **Coupling** | Loosely coupled, reusable activities | Tightly coupled to saga workflow |
| **Coordination** | Dynamic itinerary with variables | Fixed state transitions |
| **Compensation** | Automatic on activity fault | Manual trigger via `Compensate(ctx)` |
| **Use Case** | Multi-service workflows | Long-running business processes |
| **Reusability** | Activities are independent and reusable | Compensations tied to saga definition |

**When to use Routing Slips:**
- Coordinating operations across multiple independent services
- Dynamic workflows that may change based on runtime conditions
- Reusable activity components

**When to use Saga Compensation:**
- Complex business processes with many state transitions
- Long-running processes that need persistence
- Event-driven architectures

## Core Components

### 1. Activities

Activities are self-contained units of work that can execute and optionally compensate.

#### IActivity<TArguments, TLog>

Full activity with compensation support:

```typescript
import { IActivity, IExecuteContext, IActivityResult, ICompensateContext } from 'nestjs-bustransit';

export class ProcessPaymentActivity implements IActivity<ProcessPaymentArguments, ProcessPaymentLog> {
    name = 'ProcessPayment';

    async execute(context: IExecuteContext<ProcessPaymentArguments>): Promise<IActivityResult> {
        // Execute the activity
        const paymentIntentId = await processPayment(context.arguments);

        // Store data in variables for later activities
        const variables = new Map(context.variables);
        variables.set('paymentIntentId', paymentIntentId);

        // Return with compensation log
        return context.completedWithVariables(variables, {
            paymentIntentId,
            amount: context.arguments.amount,
            timestamp: new Date()
        });
    }

    async compensate(context: ICompensateContext<ProcessPaymentLog>): Promise<void> {
        // Undo the activity
        await refundPayment(context.compensationLog.paymentIntentId);
    }
}
```

#### IExecuteActivity<TArguments>

Execute-only activity without compensation:

```typescript
import { IExecuteActivity, IExecuteContext, IActivityResult } from 'nestjs-bustransit';

export class SendEmailActivity implements IExecuteActivity<SendEmailArguments> {
    name = 'SendEmail';

    async execute(context: IExecuteContext<SendEmailArguments>): Promise<IActivityResult> {
        // Execute the activity
        await sendEmail(context.arguments.email, context.arguments.template);

        // No compensation - emails cannot be "unsent"
        return context.completed();
    }
}
```

### 2. Execute Context

The context provided to activities during execution:

```typescript
interface IExecuteContext<TArguments> {
    trackingNumber: string;              // Routing slip tracking ID
    arguments: TArguments;               // Activity-specific arguments
    variables: Map<string, any>;         // Shared variables from previous activities

    // Return successful completion
    completed(compensationLog?: any): IActivityResult;

    // Return completion with new/updated variables
    completedWithVariables(variables: Map<string, any>, compensationLog?: any): IActivityResult;

    // Trigger compensation by faulting
    faulted(exception: Error): IActivityResult;

    // Terminate the routing slip gracefully
    terminated(): IActivityResult;
}
```

### 3. Activity Results

Activities return one of three result types:

**Complete**: Activity executed successfully
```typescript
return context.completed(compensationLog);
```

**Fault**: Activity failed - triggers compensation of all previous activities
```typescript
return context.faulted(new Error('Payment declined'));
```

**Terminate**: Stop execution gracefully without compensation
```typescript
return context.terminated();
```

### 4. Routing Slip Builder

Fluent API for building routing slips:

```typescript
import { RoutingSlipBuilder } from 'nestjs-bustransit';

const routingSlip = RoutingSlipBuilder.create('order-123')
    .addActivity('ProcessPayment', 'payment-service', {
        orderId: 'order-123',
        amount: 99.99
    })
    .addActivity('ReserveInventory', 'inventory-service', {
        orderId: 'order-123',
        items: [{ sku: 'ITEM-001', quantity: 2 }]
    })
    .addActivity('SendConfirmation', 'notification-service', {
        orderId: 'order-123',
        email: 'customer@example.com'
    })
    .addVariable('orderId', 'order-123')
    .addVariable('customerEmail', 'customer@example.com')
    .build();
```

### 5. Routing Slip Executor

Executes routing slips with automatic compensation:

```typescript
import { RoutingSlipExecutor } from 'nestjs-bustransit';

const executor = new RoutingSlipExecutor(activityFactory);

// Execute the routing slip
await executor.execute(routingSlip);
```

### 6. Event System

Monitor routing slip execution with event subscribers:

```typescript
executor.subscribe({
    async onCompleted(event) {
        console.log(`Completed: ${event.trackingNumber} in ${event.duration}ms`);
    },

    async onFaulted(event) {
        console.error(`Faulted: ${event.trackingNumber}`);
        console.error(`Exceptions: ${event.activityExceptions.map(e => e.exceptionInfo.message)}`);
    },

    async onActivityCompleted(event) {
        console.log(`Activity completed: ${event.activityName}`);
    },

    async onActivityCompensated(event) {
        console.log(`Activity compensated: ${event.activityName}`);
    }
});
```

## Complete Example

### 1. Define Activities

```typescript
// ProcessPaymentActivity.ts
@Injectable()
export class ProcessPaymentActivity implements IActivity<ProcessPaymentArgs, ProcessPaymentLog> {
    name = 'ProcessPayment';

    async execute(context: IExecuteContext<ProcessPaymentArgs>): Promise<IActivityResult> {
        const paymentId = await this.paymentService.charge(context.arguments.amount);

        const variables = new Map(context.variables);
        variables.set('paymentId', paymentId);

        return context.completedWithVariables(variables, { paymentId, amount: context.arguments.amount });
    }

    async compensate(context: ICompensateContext<ProcessPaymentLog>): Promise<void> {
        await this.paymentService.refund(context.compensationLog.paymentId);
    }
}

// ReserveInventoryActivity.ts
@Injectable()
export class ReserveInventoryActivity implements IActivity<ReserveInventoryArgs, ReserveInventoryLog> {
    name = 'ReserveInventory';

    async execute(context: IExecuteContext<ReserveInventoryArgs>): Promise<IActivityResult> {
        const reservationId = await this.inventoryService.reserve(context.arguments.items);

        const variables = new Map(context.variables);
        variables.set('reservationId', reservationId);

        return context.completedWithVariables(variables, { reservationId, items: context.arguments.items });
    }

    async compensate(context: ICompensateContext<ReserveInventoryLog>): Promise<void> {
        await this.inventoryService.release(context.compensationLog.reservationId);
    }
}
```

### 2. Create Activity Factory

```typescript
@Injectable()
export class OrderActivityFactory implements IActivityFactory {
    private activities = new Map();

    constructor(
        private readonly processPayment: ProcessPaymentActivity,
        private readonly reserveInventory: ReserveInventoryActivity
    ) {
        this.activities.set('ProcessPayment', this.processPayment);
        this.activities.set('ReserveInventory', this.reserveInventory);
    }

    createActivity(activityName: string): any {
        return this.activities.get(activityName);
    }
}
```

### 3. Create Service

```typescript
@Injectable()
export class OrderService {
    private executor: RoutingSlipExecutor;

    constructor(activityFactory: OrderActivityFactory) {
        this.executor = new RoutingSlipExecutor(activityFactory);
    }

    async processOrder(order: Order): Promise<void> {
        const routingSlip = RoutingSlipBuilder.create(order.id)
            .addActivity('ProcessPayment', 'payment', {
                orderId: order.id,
                amount: order.total
            })
            .addActivity('ReserveInventory', 'inventory', {
                orderId: order.id,
                items: order.items
            })
            .addVariable('orderId', order.id)
            .build();

        await this.executor.execute(routingSlip);
    }
}
```

### 4. Register in Module

```typescript
@Module({
    providers: [
        ProcessPaymentActivity,
        ReserveInventoryActivity,
        OrderActivityFactory,
        OrderService
    ]
})
export class OrderModule {}
```

## Execution Flow

### Success Flow

```
1. ProcessPayment Activity
   ├─ Execute: Charge $99.99
   ├─ Store: paymentId in variables
   └─ Result: Completed with compensation log

2. ReserveInventory Activity
   ├─ Execute: Reserve 2 units
   ├─ Access: paymentId from variables
   ├─ Store: reservationId in variables
   └─ Result: Completed with compensation log

3. SendConfirmation Activity
   ├─ Execute: Send email
   ├─ Access: paymentId, reservationId from variables
   └─ Result: Completed

✅ Routing Slip Completed
```

### Failure Flow with Compensation

```
1. ProcessPayment Activity
   ├─ Execute: Charge $99.99
   ├─ Store: paymentId in variables
   └─ Result: Completed ✓

2. ReserveInventory Activity
   ├─ Execute: Reserve 2 units
   └─ Result: Faulted (out of stock) ❌

🔄 Starting Compensation (LIFO)

3. Compensate: ProcessPayment
   ├─ Access: Compensation log (paymentId, amount)
   ├─ Execute: Refund $99.99
   └─ Result: Compensated ✓

❌ Routing Slip Faulted (with all compensations completed)
```

## Best Practices

### 1. Activity Design

- **Single Responsibility**: Each activity should do one thing
- **Idempotent**: Activities should be safe to retry
- **Stateless**: Don't store state in activity instances
- **Defensive**: Validate arguments and handle errors gracefully

### 2. Compensation

- **Idempotent Compensation**: Compensations should be safe to execute multiple times
- **Log Everything**: Store enough data in compensation logs to undo the action
- **Handle Failures**: Plan for compensation failures
- **Eventual Consistency**: Accept that compensation may not be instant

### 3. Variables

- **Use Variables**: Pass data between activities using variables
- **Minimize Data**: Only pass what's needed
- **Immutable**: Treat variables as immutable, create new maps when updating

### 4. Error Handling

```typescript
async execute(context: IExecuteContext<Args>): Promise<IActivityResult> {
    try {
        // Execute business logic
        const result = await this.doWork(context.arguments);
        return context.completed(result);
    } catch (error) {
        // Log and fault
        Logger.error(`Activity failed: ${error.message}`);
        return context.faulted(error);
    }
}
```

### 5. Logging

```typescript
async execute(context: IExecuteContext<Args>): Promise<IActivityResult> {
    Logger.log(`[${this.name}] Starting execution for ${context.trackingNumber}`);
    Logger.log(`[${this.name}] Arguments: ${JSON.stringify(context.arguments)}`);

    // ... execution logic

    Logger.log(`[${this.name}] Completed successfully`);
    return context.completed(log);
}
```

## Advanced Patterns

### Dynamic Itinerary Revision

Activities can modify the itinerary during execution:

```typescript
async execute(context: IExecuteContext<Args>): Promise<IActivityResult> {
    if (needsAdditionalProcessing) {
        return context.reviseItinerary((builder) => {
            builder.addActivity('ExtraStep', 'service', args);
        });
    }
    return context.completed();
}
```

### Conditional Activities

Build routing slips dynamically based on conditions:

```typescript
const builder = RoutingSlipBuilder.create(orderId);

builder.addActivity('ProcessPayment', 'payment', paymentArgs);

if (order.isInternational) {
    builder.addActivity('CheckCustoms', 'customs', customsArgs);
}

builder.addActivity('Ship', 'shipping', shippingArgs);

const routingSlip = builder.build();
```

### Event-Driven Integration

Use routing slip events to publish messages to other services:

```typescript
executor.subscribe({
    async onCompleted(event) {
        // Publish order completed event
        await messageBus.publish(new OrderCompleted(event.trackingNumber));
    },

    async onFaulted(event) {
        // Publish order failed event
        await messageBus.publish(new OrderFailed(
            event.trackingNumber,
            event.activityExceptions
        ));
    }
});
```

## Troubleshooting

### Activity Not Found

Ensure the activity is registered in your activity factory:

```typescript
this.activities.set('ActivityName', activityInstance);
```

### Compensation Not Executing

- Check that the activity implements `IActivity` (not `IExecuteActivity`)
- Verify the `compensate` method is defined
- Ensure a compensation log was provided in `completed()`

### Variables Not Available

- Variables must be set before they can be accessed
- Use `completedWithVariables()` to add variables
- Previous activities must complete successfully for variables to be available

## Migration from Saga Compensation

If you're currently using saga compensation and want to migrate to routing slips:

1. **Extract Activities**: Convert saga steps into reusable activity classes
2. **Replace Events**: Use routing slip execution instead of event-driven saga steps
3. **Keep Sagas for State**: Use sagas for state management, routing slips for orchestration
4. **Gradual Migration**: Both patterns can coexist in the same application

Example migration:

**Before (Saga Compensation):**
```typescript
this.When(PaymentProcessed)
    .Then(c => { /* process payment */ })
    .Compensate(async c => { /* refund payment */ })
    .TransitionTo(this.NextState)
```

**After (Routing Slips):**
```typescript
// ProcessPaymentActivity.ts
class ProcessPaymentActivity implements IActivity<Args, Log> {
    async execute(ctx) { /* process payment */ }
    async compensate(ctx) { /* refund payment */ }
}

// Usage
const routingSlip = RoutingSlipBuilder.create()
    .addActivity('ProcessPayment', 'payment', args)
    .build();
```

## Learn More

### Documentation

- 📖 **[Routing Slips Concepts](./ROUTING_SLIPS_CONCEPTS.md)** - Comprehensive guide to the pattern
  - What is a routing slip and why use it?
  - Core concepts explained in detail
  - Visual diagrams of execution flow
  - End-to-end examples with success and failure scenarios
  - Design patterns and best practices


- 📚 **[Saga Compensation Pattern](./COMPENSATION.md)** - Alternative pattern
  - Event-driven compensation in sagas
  - State machine based workflows
  - Best for long-running processes

- 📋 **[Implementation Summary](./ROUTING_SLIPS_IMPLEMENTATION_SUMMARY.md)** - Technical details
  - Files created and modified
  - Architecture and design decisions
  - Technical notes and considerations

### External Resources

- [MassTransit Routing Slips](https://masstransit.io/documentation/concepts/routing-slips) - Original pattern documentation
- [Saga Pattern](https://microservices.io/patterns/data/saga.html) - General saga pattern information
