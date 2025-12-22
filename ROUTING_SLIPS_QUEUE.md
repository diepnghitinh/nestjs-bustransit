# Routing Slips Pattern in NestJS BusTransit

This document explains how routing slips work in the NestJS BusTransit library and how they differ from MassTransit's implementation.

## Overview

The NestJS BusTransit library implements the **Routing Slip pattern** for coordinating distributed transactions with automatic compensation. Unlike MassTransit which uses message queues for each activity, this library executes activities **in-process** within your NestJS application.

## Key Differences from MassTransit

### MassTransit Approach
- Each activity has dedicated message queues (`activity_execute` and `activity_compensate`)
- Activities are distributed across different services
- Routing slips are sent as messages between services
- Automatic queue provisioning in the message broker

### NestJS BusTransit Approach
- Activities execute **in-process** within a single NestJS application
- No separate queues needed for each activity
- Routing slips are executed by the `RoutingSlipExecutor` service
- Compensation happens automatically in reverse order (LIFO)

## How It Works

### 1. Activity Registration

Activities are registered using dependency injection:

```typescript
@Module({
  providers: [
    // Register activities
    ProcessPaymentActivity,
    ReserveInventoryActivity,
    SendConfirmationActivity,

    // Register factory
    OrderActivityFactory,

    // Register service
    OrderProcessingService,
  ],
})
export class AppModule {}
```

### 2. Activity Factory

The activity factory creates instances of activities:

```typescript
@Injectable()
export class OrderActivityFactory implements IActivityFactory {
    private activities = new Map();

    constructor(
        private readonly processPaymentActivity: ProcessPaymentActivity,
        private readonly reserveInventoryActivity: ReserveInventoryActivity,
        private readonly sendConfirmationActivity: SendConfirmationActivity
    ) {
        this.activities.set('ProcessPayment', this.processPaymentActivity);
        this.activities.set('ReserveInventory', this.reserveInventoryActivity);
        this.activities.set('SendConfirmation', this.sendConfirmationActivity);
    }

    createActivity(activityName: string): any {
        return this.activities.get(activityName);
    }
}
```

### 3. Routing Slip Execution

The `RoutingSlipExecutor` executes activities sequentially:

```typescript
@Injectable()
export class OrderProcessingService {
    private executor: RoutingSlipExecutor;

    constructor(activityFactory: OrderActivityFactory) {
        this.executor = new RoutingSlipExecutor(activityFactory);
    }

    async processOrder(orderId: string, amount: number, items: any[]): Promise<void> {
        const routingSlip = RoutingSlipBuilder.create(orderId)
            .addActivity('ProcessPayment', 'payment-service', { orderId, amount })
            .addActivity('ReserveInventory', 'inventory-service', { orderId, items })
            .addActivity('SendConfirmation', 'notification-service', { orderId })
            .build();

        await this.executor.execute(routingSlip);
    }
}
```

## Execution Flow

1. **Build Routing Slip**: Use `RoutingSlipBuilder` to define the sequence of activities
2. **Execute Activities**: `RoutingSlipExecutor` runs each activity in order
3. **Track Compensation Logs**: Successful activities store compensation logs
4. **Handle Failures**: If an activity fails, all completed activities are compensated in reverse order (LIFO)
5. **Emit Events**: Event subscribers receive notifications about activity execution, completion, and compensation

## When to Use Routing Slips

### ✅ Good Use Cases (In-Process)
- Coordinating multiple operations within a single service
- Complex business transactions requiring compensation
- Operations that need to be atomic (all-or-nothing)
- When you need detailed logging and monitoring of each step

### ❌ Not Ideal For (Use Distributed Saga Instead)
- Operations spanning multiple microservices
- Long-running workflows (hours/days)
- Scenarios requiring service independence and fault isolation

## Comparison with Saga State Machines

This library also implements **Saga State Machines** for distributed, event-driven workflows:

| Feature | Routing Slips | Saga State Machines |
|---------|--------------|---------------------|
| Execution | Sequential (in-process) | Event-driven (distributed) |
| Compensation | Automatic (LIFO) | Manual (per state) |
| Services | Single service | Multiple services |
| Message Broker | Optional | Required |
| Best For | Complex transactions | Long-running workflows |

## Message Queues (Optional)

While routing slips execute in-process, you can still use message queues for:
- **Triggering routing slips**: Send a message to start a routing slip execution
- **Event notifications**: Publish events when routing slips complete or fail
- **Integration**: Coordinate with other services using the saga state machine pattern

### Example: Queue-Triggered Routing Slip

```typescript
@Injectable()
export class OrderConsumer {
    constructor(private orderProcessingService: OrderProcessingService) {}

    @Subscribe(OrderSubmitted)
    async handle(message: OrderSubmitted): Promise<void> {
        // Message received from queue triggers routing slip execution
        await this.orderProcessingService.processOrder(
            message.orderId,
            message.amount,
            message.items
        );
    }
}
```

## Best Practices

1. **Keep Activities Small**: Each activity should do one thing well
2. **Design for Compensation**: Every activity that changes state should have a compensate method
3. **Use Variables**: Share data between activities using routing slip variables
4. **Monitor Events**: Subscribe to routing slip events for observability
5. **Handle Failures**: Test compensation logic thoroughly

## For More Information

- See `COMPENSATION.md` for detailed examples and patterns
- Check `example/src/infrastructure/messaging/routing-slips/` for working examples
- Review the API documentation at `/lib/routing-slips/index.ts`

## Migration from MassTransit

If you're coming from MassTransit:
- Remove queue configuration for individual activities
- Activities become injectable services instead of queue consumers
- Replace distributed execution with in-process `RoutingSlipExecutor`
- Use saga state machines for truly distributed workflows
