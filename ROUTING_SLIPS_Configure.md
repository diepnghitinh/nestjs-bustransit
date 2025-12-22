# Routing Slips Configuration Guide

This guide explains how to configure routing slips in NestJS BusTransit, inspired by MassTransit's convention-based approach.

## Quick Start

### 1. Define Activities with Decorator

Activities are marked with the `@RoutingSlipActivity()` decorator for automatic discovery:

```typescript
import { Injectable } from '@nestjs/common';
import {
    RoutingSlipActivity,
    IActivity,
    IExecuteContext,
    ICompensateContext,
    IActivityResult
} from 'nestjs-bustransit';

@RoutingSlipActivity({ name: 'ProcessPayment' })
@Injectable()
export class ProcessPaymentActivity implements IActivity<ProcessPaymentArgs, ProcessPaymentLog> {
    name = 'ProcessPayment';

    async execute(context: IExecuteContext<ProcessPaymentArgs>): Promise<IActivityResult> {
        // Process payment logic
        const paymentId = await this.processPayment(context.args);

        // Return with compensation log
        return context.completedWithVariables(
            new Map([['paymentId', paymentId]]),
            { paymentId, amount: context.args.amount }
        );
    }

    async compensate(context: ICompensateContext<ProcessPaymentLog>): Promise<void> {
        // Refund logic
        await this.refundPayment(context.compensationLog.paymentId);
    }
}
```

### 2. Configure Module

Configure the routing slip module in your app module:

```typescript
import { Module } from '@nestjs/common';
import { RoutingSlipModule, RoutingSlipExecutionMode } from 'nestjs-bustransit';
import { ProcessPaymentActivity } from './activities/process-payment.activity';
import { ReserveInventoryActivity } from './activities/reserve-inventory.activity';

@Module({
    imports: [
        // Configure routing slips with automatic activity discovery
        RoutingSlipModule.forRoot({
            executionMode: RoutingSlipExecutionMode.InProcess,
            enableEventSubscribers: true
        })
    ],
    providers: [
        // Register activities - they will be auto-discovered by decorator
        ProcessPaymentActivity,
        ReserveInventoryActivity,
    ]
})
export class AppModule {}
```

### 3. Use Routing Slip Service

Execute routing slips using the `RoutingSlipService`:

```typescript
import { Injectable } from '@nestjs/common';
import { RoutingSlipService } from 'nestjs-bustransit';

@Injectable()
export class OrderService {
    constructor(private readonly routingSlipService: RoutingSlipService) {}

    async processOrder(orderId: string, amount: number) {
        // Build routing slip
        const routingSlip = this.routingSlipService
            .createBuilder(orderId)
            .addActivity('ProcessPayment', 'payment-service', {
                orderId,
                amount
            })
            .addActivity('ReserveInventory', 'inventory-service', {
                orderId
            })
            .build();

        // Execute routing slip
        await this.routingSlipService.execute(routingSlip);
    }
}
```

## Configuration Options

### Module Configuration

#### Basic Configuration

```typescript
RoutingSlipModule.forRoot({
    // Execution mode: InProcess or Distributed
    executionMode: RoutingSlipExecutionMode.InProcess,

    // Enable event subscribers
    enableEventSubscribers: true
})
```

#### Distributed Mode (Future)

For distributed execution across microservices:

```typescript
RoutingSlipModule.forRoot({
    executionMode: RoutingSlipExecutionMode.Distributed,
    queuePrefix: 'myapp',  // Queues will be: myapp-process-payment_execute
    autoProvisionQueues: true
})
```

#### Async Configuration

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

### Activity Configuration

#### Activity Decorator Options

```typescript
@RoutingSlipActivity({
    // Activity name (defaults to class name)
    name: 'ProcessPayment',

    // Queue address for distributed mode (optional)
    queueAddress: 'payment-queue',

    // Enable automatic queue provisioning
    autoProvision: true
})
```

#### Execute-Only Activity (No Compensation)

```typescript
@RoutingSlipActivity({ name: 'SendEmail' })
@Injectable()
export class SendEmailActivity implements IExecuteActivity<SendEmailArgs> {
    name = 'SendEmail';

    async execute(context: IExecuteContext<SendEmailArgs>): Promise<IActivityResult> {
        await this.sendEmail(context.args.email);
        return context.completed();
    }

    // No compensate method - this is execute-only
}
```

## Feature Modules

Register activities in feature modules:

```typescript
@Module({
    imports: [
        // Register activities specific to this feature
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

## Comparison with MassTransit

### MassTransit (.NET)

```csharp
services.AddMassTransit(x =>
{
    // Register activity
    x.AddActivity<ProcessPaymentActivity, ProcessPaymentArgs, ProcessPaymentLog>();

    x.UsingRabbitMq((context, cfg) =>
    {
        cfg.Host("localhost", "/", h => {
            h.Username("guest");
            h.Password("guest");
        });

        // Auto-configure endpoints and queues
        cfg.ConfigureEndpoints(context);
    });
});
```

### NestJS BusTransit

```typescript
@Module({
    imports: [
        RoutingSlipModule.forRoot({
            executionMode: RoutingSlipExecutionMode.InProcess,
            enableEventSubscribers: true
        })
    ],
    providers: [
        // Activities auto-discovered via @RoutingSlipActivity decorator
        ProcessPaymentActivity,
    ]
})
export class AppModule {}
```

## Key Differences

| Feature | MassTransit | NestJS BusTransit |
|---------|-------------|-------------------|
| Activity Registration | `AddActivity<T, TArgs, TLog>()` | `@RoutingSlipActivity()` decorator |
| Discovery | Reflection-based | NestJS Discovery Service |
| Queue Provisioning | Automatic via ConfigureEndpoints | In-process (no queues) or manual |
| Execution | Distributed via message broker | In-process by default |
| Configuration | Startup.cs / Program.cs | Module forRoot() |

## Event Monitoring

Subscribe to routing slip events:

```typescript
import { Injectable } from '@nestjs/common';
import { RoutingSlipService, IRoutingSlipEventSubscriber } from 'nestjs-bustransit';

@Injectable()
export class OrderService {
    constructor(private readonly routingSlipService: RoutingSlipService) {
        // Subscribe to events
        this.routingSlipService.subscribe({
            async onCompleted(event) {
                console.log('Routing slip completed:', event.trackingNumber);
            },

            async onActivityFaulted(event) {
                console.error('Activity failed:', event.activityName);
            },

            async onActivityCompensated(event) {
                console.log('Activity compensated:', event.activityName);
            }
        });
    }
}
```

## Automatic Activity Discovery

Activities are automatically discovered when:

1. **Decorated with `@RoutingSlipActivity()`**
2. **Registered as providers** in a module
3. **Module imports `RoutingSlipModule`**

The `RoutingSlipActivityFactory` uses NestJS's Discovery Service to find all decorated activities and register them automatically.

## Best Practices

### 1. Use Descriptive Activity Names

```typescript
@RoutingSlipActivity({ name: 'ProcessPayment' })  // Good
@RoutingSlipActivity({ name: 'Activity1' })        // Bad
```

### 2. Keep Activities Small and Focused

```typescript
// Good - Single responsibility
@RoutingSlipActivity({ name: 'ProcessPayment' })
export class ProcessPaymentActivity { /* ... */ }

@RoutingSlipActivity({ name: 'SendReceipt' })
export class SendReceiptActivity { /* ... */ }

// Bad - Too many responsibilities
@RoutingSlipActivity({ name: 'ProcessPaymentAndSendReceipt' })
export class ProcessPaymentAndSendReceiptActivity { /* ... */ }
```

### 3. Design for Compensation

```typescript
@RoutingSlipActivity({ name: 'ReserveInventory' })
export class ReserveInventoryActivity implements IActivity<Args, Log> {
    async execute(context) {
        const reservationId = await this.reserve(context.args);

        // Store data needed for compensation
        return context.completed({ reservationId, items: context.args.items });
    }

    async compensate(context) {
        // Use compensation log to undo
        await this.release(context.compensationLog.reservationId);
    }
}
```

### 4. Use Feature Modules

Organize activities by domain:

```typescript
// payment.module.ts
@Module({
    imports: [RoutingSlipModule.forFeature([
        ProcessPaymentActivity,
        RefundPaymentActivity
    ])],
    // ...
})
export class PaymentModule {}

// inventory.module.ts
@Module({
    imports: [RoutingSlipModule.forFeature([
        ReserveInventoryActivity,
        ReleaseInventoryActivity
    ])],
    // ...
})
export class InventoryModule {}
```

## Migration from Manual Configuration

### Before (Manual Factory)

```typescript
@Injectable()
export class OrderActivityFactory implements IActivityFactory {
    constructor(
        private readonly processPayment: ProcessPaymentActivity,
        private readonly reserveInventory: ReserveInventoryActivity
    ) {}

    createActivity(name: string) {
        const activities = {
            'ProcessPayment': this.processPayment,
            'ReserveInventory': this.reserveInventory
        };
        return activities[name];
    }
}

// Manual executor creation
const executor = new RoutingSlipExecutor(activityFactory);
```

### After (Automatic Discovery)

```typescript
// Just use the decorator
@RoutingSlipActivity({ name: 'ProcessPayment' })
@Injectable()
export class ProcessPaymentActivity { /* ... */ }

// And inject the service
constructor(private readonly routingSlipService: RoutingSlipService) {}

// Activities are automatically discovered and registered
await this.routingSlipService.execute(routingSlip);
```

## Advanced Configuration

### Custom Activity Factory

Provide a custom factory if needed:

```typescript
RoutingSlipModule.forRoot({
    activityFactory: MyCustomActivityFactory
})
```

### Queue-Based Execution (Future Feature)

For distributed scenarios:

```typescript
@RoutingSlipActivity({
    name: 'ProcessPayment',
    queueAddress: 'payment-service-queue',
    autoProvision: true
})
export class ProcessPaymentActivity { /* ... */ }
```

This will automatically provision:
- `payment-service-queue_execute` for executions
- `payment-service-queue_compensate` for compensations

## Summary

The NestJS BusTransit routing slip configuration provides:

✅ **Automatic Activity Discovery** via decorators
✅ **Convention over Configuration** like MassTransit
✅ **Simple Module Setup** with forRoot/forFeature
✅ **Type-Safe** with full TypeScript support
✅ **Flexible** - supports both in-process and distributed modes
✅ **DI-Friendly** - leverages NestJS dependency injection

For more examples, see the `/example` directory in the repository.
