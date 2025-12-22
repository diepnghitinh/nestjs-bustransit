# Routing Slips Distributed Mode

This document explains how to use routing slips in distributed mode with queue-based execution across microservices.

## Overview

The routing slip pattern supports two execution modes:

1. **In-Process Mode** (default) - Activities are executed directly in the same process
2. **Distributed Mode** - Activities are executed via message queues, enabling true distributed transactions across microservices

## How Distributed Mode Works

In distributed mode, instead of calling activity methods directly, the routing slip executor:

1. **Publishes execute messages** to activity-specific execute queues
2. **Activity consumers** listen to these queues and execute the activities
3. **Response messages** are published back (request/reply pattern)
4. **On failure**, compensate messages are sent to compensate queues
5. **Compensation consumers** handle the rollback logic

### Queue Naming Convention

For each activity, two queues are automatically created:

- `{prefix}_{activity-name}_execute` - For execute operations
- `{prefix}_{activity-name}_compensate` - For compensate operations (if activity supports compensation)

Example with prefix "myapp":
- `myapp_process-payment_execute`
- `myapp_process-payment_compensate`
- `myapp_reserve-inventory_execute`
- `myapp_reserve-inventory_compensate`

## Configuration

### 1. Enable Distributed Mode

Configure the routing slip module with distributed execution mode:

```typescript
import { Module } from '@nestjs/common';
import { RoutingSlipModule, RoutingSlipExecutionMode } from 'nestjs-bustransit';

@Module({
    imports: [
        RoutingSlipModule.forRoot({
            // Enable distributed mode
            executionMode: RoutingSlipExecutionMode.Distributed,

            // Queue prefix for all activities
            queuePrefix: 'myapp',

            // Automatically provision queues
            autoProvisionQueues: true,

            // Enable event subscribers
            enableEventSubscribers: true
        })
    ],
    providers: [
        // Your activities
        ProcessPaymentActivity,
        ReserveInventoryActivity,
        SendConfirmationActivity
    ]
})
export class AppModule {}
```

### 2. Activity Configuration

Activities can optionally specify a custom queue address:

```typescript
@RoutingSlipActivity({
    name: 'ProcessPayment',
    queueAddress: 'payment-service-queue', // Optional custom queue name
    autoProvision: true // Auto-provision this queue
})
@Injectable()
export class ProcessPaymentActivity implements IActivity<ProcessPaymentArgs, ProcessPaymentLog> {
    name = 'ProcessPayment';

    async execute(context: IExecuteContext<ProcessPaymentArgs>): Promise<IActivityResult> {
        // Execute logic
        const paymentId = await this.processPayment(context.args);

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

This will create:
- `myapp_payment-service-queue_execute`
- `myapp_payment-service-queue_compensate`

If no `queueAddress` is specified, the activity name is normalized:
- `ProcessPayment` → `myapp_process-payment_execute`

### 3. Async Configuration

For dynamic configuration:

```typescript
RoutingSlipModule.forRootAsync({
    useFactory: (configService: ConfigService) => ({
        executionMode: configService.get('ROUTING_SLIP_MODE') === 'distributed'
            ? RoutingSlipExecutionMode.Distributed
            : RoutingSlipExecutionMode.InProcess,
        queuePrefix: configService.get('QUEUE_PREFIX'),
        autoProvisionQueues: true
    }),
    inject: [ConfigService]
})
```

## Queue Provisioning

The `RoutingSlipQueueProvisioningService` automatically:

1. **Discovers all activities** using the `@RoutingSlipActivity` decorator
2. **Determines queue names** based on activity name or custom queue address
3. **Creates queue configurations** for execute and compensate operations
4. **Provisions queues** when `autoProvisionQueues` is enabled

### Inspecting Queue Configurations

```typescript
import { Injectable } from '@nestjs/common';
import { RoutingSlipQueueProvisioningService } from 'nestjs-bustransit';

@Injectable()
export class DebugService {
    constructor(
        private readonly queueProvisioning: RoutingSlipQueueProvisioningService
    ) {}

    getQueueInfo() {
        const configs = this.queueProvisioning.getAllQueueConfigurations();

        configs.forEach(config => {
            console.log(`Activity: ${config.activityName}`);
            console.log(`  Execute Queue: ${config.executeQueueName}`);
            if (config.hasCompensation) {
                console.log(`  Compensate Queue: ${config.compensateQueueName}`);
            }
        });
    }
}
```

## Message Flow

### Execute Flow

```
1. RoutingSlipService.execute(routingSlip)
   ↓
2. DistributedExecutor publishes RoutingSlipActivityExecuteMessage to execute queue
   ↓
3. ActivityExecuteConsumer receives message
   ↓
4. Activity.execute() is called
   ↓
5. RoutingSlipActivityExecuteResponseMessage is published (request/reply)
   ↓
6. DistributedExecutor receives response and continues to next activity
```

### Compensate Flow (on failure)

```
1. Activity fails during execute
   ↓
2. DistributedExecutor enters compensation mode
   ↓
3. For each completed activity (in reverse order):
   DistributedExecutor publishes RoutingSlipActivityCompensateMessage to compensate queue
   ↓
4. ActivityCompensateConsumer receives message
   ↓
5. Activity.compensate() is called
   ↓
6. RoutingSlipActivityCompensateResponseMessage is published
   ↓
7. DistributedExecutor receives response and continues to next compensation
```

## Message Schemas

### Execute Message

```typescript
interface IRoutingSlipActivityExecuteMessage<TArguments> {
    trackingNumber: string;
    activityName: string;
    executionId: string;
    args: TArguments;
    variables: Record<string, any>;
    timestamp: Date;
    correlationId?: string;
}
```

### Execute Response

```typescript
interface IRoutingSlipActivityExecuteResponse {
    trackingNumber: string;
    activityName: string;
    executionId: string;
    success: boolean;
    resultType: 'Complete' | 'Fault' | 'Terminate';
    compensationLog?: any;
    variables?: Record<string, any>;
    error?: { message: string; stack?: string };
    duration: number;
    timestamp: Date;
    correlationId?: string;
}
```

### Compensate Message

```typescript
interface IRoutingSlipActivityCompensateMessage<TLog> {
    trackingNumber: string;
    activityName: string;
    compensationLog: TLog;
    variables: Record<string, any>;
    timestamp: Date;
    correlationId?: string;
}
```

### Compensate Response

```typescript
interface IRoutingSlipActivityCompensateResponse {
    trackingNumber: string;
    activityName: string;
    success: boolean;
    error?: { message: string; stack?: string };
    timestamp: Date;
    correlationId?: string;
}
```

## Architecture

### Components

1. **RoutingSlipDistributedExecutor** - Coordinates distributed routing slip execution
2. **RoutingSlipQueueProvisioningService** - Manages queue configuration and provisioning
3. **ActivityExecuteConsumerFactory** - Creates execute consumers dynamically
4. **ActivityCompensateConsumerFactory** - Creates compensate consumers dynamically
5. **Message Classes** - Type-safe message definitions

### Consumer Registration

Consumers are created dynamically for each activity:

```typescript
const executeConsumer = ActivityExecuteConsumerFactory.createConsumer(
    'ProcessPayment',
    processPaymentActivity
);

const compensateConsumer = ActivityCompensateConsumerFactory.createConsumer(
    'ProcessPayment',
    processPaymentActivity
);
```

## Current Implementation Status

### ✅ Implemented

- Queue configuration and naming
- Message class definitions
- Consumer factories for execute/compensate
- Distributed executor with message publishing
- Automatic activity discovery
- Queue provisioning service
- Dual-mode support (in-process & distributed)

### ⚠️ Simplified / Demo Mode

The current implementation includes simplified versions of:

- **Request/Reply Pattern** - Messages are published but response handling is simplified
- **Correlation Management** - Correlation IDs are generated but full correlation logic is basic
- **Fallback Execution** - Falls back to in-process execution as proof of concept

### 🚧 Future Enhancements

For production use, consider implementing:

- **Message Broker Integration** - Full RabbitMQ queue setup and consumer registration
- **Request/Reply Coordination** - Proper correlation ID management and response waiting
- **Timeout Handling** - Activity execution timeouts
- **Dead Letter Queues** - Failed message handling
- **Retry Policies** - Automatic retries with exponential backoff
- **State Persistence** - Routing slip state storage for recovery
- **Idempotency** - Ensure activities can be safely retried
- **Monitoring & Observability** - Distributed tracing, metrics

## Comparison: In-Process vs Distributed

| Feature | In-Process | Distributed |
|---------|-----------|-------------|
| **Execution** | Direct method calls | Message queues |
| **Latency** | Low (~ms) | Higher (~100ms+) |
| **Scalability** | Limited to single process | Horizontal scaling |
| **Fault Tolerance** | Process failure = loss | Queue persistence |
| **Microservices** | Same service only | Cross-service support |
| **Debugging** | Easier | More complex |
| **Setup** | Simple | Requires message broker |

## When to Use Distributed Mode

Use distributed mode when:

- ✅ Activities span multiple microservices
- ✅ You need horizontal scalability
- ✅ Long-running activities require persistence
- ✅ You want fault tolerance and recovery
- ✅ Load balancing across workers is needed

Use in-process mode when:

- ✅ All activities are in the same service
- ✅ Low latency is critical
- ✅ Simple deployment is preferred
- ✅ Message broker overhead is unnecessary

## Example: Switching Modes

### In-Process (Current)

```typescript
RoutingSlipModule.forRoot({
    executionMode: RoutingSlipExecutionMode.InProcess,
    enableEventSubscribers: true
})
```

### Distributed (New)

```typescript
RoutingSlipModule.forRoot({
    executionMode: RoutingSlipExecutionMode.Distributed,
    queuePrefix: 'myapp',
    autoProvisionQueues: true,
    enableEventSubscribers: true
})
```

The same activities and routing slip code works in both modes!

## Monitoring

Subscribe to events to monitor distributed execution:

```typescript
this.routingSlipService.subscribe({
    async onActivityCompleted(event) {
        console.log(`[Distributed] Activity completed: ${event.activityName}`);
        console.log(`  Duration: ${event.duration}ms`);
        console.log(`  Tracking: ${event.trackingNumber}`);
    },

    async onActivityFaulted(event) {
        console.error(`[Distributed] Activity faulted: ${event.activityName}`);
        console.error(`  Error: ${event.exception.exceptionInfo.message}`);
    },

    async onActivityCompensated(event) {
        console.log(`[Distributed] Activity compensated: ${event.activityName}`);
    }
});
```

## Best Practices

1. **Design for Idempotency** - Activities may be retried in distributed scenarios
2. **Use Compensation Logs** - Store all data needed to undo operations
3. **Set Appropriate Timeouts** - Configure based on activity execution time
4. **Monitor Queue Depths** - Watch for backed-up queues
5. **Test Failure Scenarios** - Verify compensation works in distributed mode
6. **Use Meaningful Queue Names** - Make troubleshooting easier
7. **Log Correlation IDs** - Track messages across services
8. **Implement Health Checks** - Monitor queue connectivity

## Troubleshooting

### Queues Not Created

Check:
- `autoProvisionQueues` is set to `true`
- Activities are registered as providers
- Activities have `@RoutingSlipActivity` decorator
- Message broker is connected

### Messages Not Being Consumed

Check:
- Consumers are registered with BusTransit
- Queue names match between publisher and consumer
- Message broker connection is active
- Consumer bindings are correct

### Compensation Not Triggering

Check:
- Activity implements `compensate()` method
- Compensation queue exists
- Compensate consumer is registered
- Activity logs are being stored

## Next Steps

1. Review the example in `/example/ROUTING_SLIPS_EXAMPLE.md`
2. Test in-process mode first
3. Set up message broker (RabbitMQ)
4. Configure distributed mode
5. Monitor queue creation and consumer registration
6. Test distributed execution
7. Implement production enhancements as needed

## Resources

- [Routing Slips Configuration Guide](./ROUTING_SLIPS_Configure.md)
- [Example Implementation](./example/ROUTING_SLIPS_EXAMPLE.md)
- [MassTransit Routing Slip Documentation](https://masstransit-project.com/usage/sagas/routing-slip.html)
