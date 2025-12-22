# Routing Slip RabbitMQ Queues

This document explains the RabbitMQ queues that are automatically created for routing slip activities in distributed mode.

## Overview

When you configure routing slips in distributed mode, the system automatically creates **execute** and **compensate** queues for each activity that has been registered with `RoutingSlipBusConfigurator`.

## Queue Naming Convention

Queues follow this naming pattern:

```
{queuePrefix}_{activity-name}_{operation}
```

Where:
- **queuePrefix**: The prefix specified in configuration (e.g., `myapp`)
- **activity-name**: The normalized activity class name (e.g., `ProcessPaymentActivity` → `process-payment-activity`)
- **operation**: Either `execute` or `compensate`

## Configured Queues for Example

Based on the current configuration in `messaging.module.ts`:

```typescript
RoutingSlipBusConfigurator.configure(x, {
    queuePrefix: 'myapp',
    activities: [
        ProcessPaymentActivity,
        ReserveInventoryActivity,
        SendConfirmationActivity,
        ValidateInventoryActivity
    ]
});
```

The following queues will be created:

### 1. ProcessPaymentActivity
- **Execute Queue**: `myapp_process-payment-activity_execute`
- **Compensate Queue**: `myapp_process-payment-activity_compensate`

**Purpose**: Processes payment for orders. Compensation refunds the payment.

### 2. ReserveInventoryActivity
- **Execute Queue**: `myapp_reserve-inventory-activity_execute`
- **Compensate Queue**: `myapp_reserve-inventory-activity_compensate`

**Purpose**: Reserves inventory for order items. Compensation releases the reservation.

### 3. SendConfirmationActivity
- **Execute Queue**: `myapp_send-confirmation-activity_execute`
- **Compensate Queue**: ❌ None (execute-only activity)

**Purpose**: Sends order confirmation email. No compensation (emails can't be unsent).

### 4. ValidateInventoryActivity
- **Execute Queue**: `myapp_validate-inventory-activity_execute`
- **Compensate Queue**: `myapp_validate-inventory-activity_compensate`

**Purpose**: Validates inventory availability. Compensation rolls back validation state.

## Total Queues Created

**7 queues** in total:
- 4 execute queues (one per activity)
- 3 compensate queues (for activities that support compensation)

## Queue Bindings

Each queue is bound to the appropriate RabbitMQ exchange based on your BusTransit configuration:

```
Exchange: {APP_NAME}:{queue_name}
Queue: {queue_name}
Routing Key: (topic exchange pattern)
```

## Verifying Queues in RabbitMQ

### 1. Using RabbitMQ Management UI

1. Open RabbitMQ Management: `http://localhost:15672`
2. Login (default: guest/guest)
3. Navigate to **Queues** tab
4. Look for queues starting with `myapp_`:

```
✓ myapp_process-payment-activity_execute
✓ myapp_process-payment-activity_compensate
✓ myapp_reserve-inventory-activity_execute
✓ myapp_reserve-inventory-activity_compensate
✓ myapp_send-confirmation-activity_execute
✓ myapp_validate-inventory-activity_execute
✓ myapp_validate-inventory-activity_compensate
```

### 2. Using rabbitmqadmin CLI

```bash
# List all queues
rabbitmqadmin list queues name

# List only routing slip queues
rabbitmqadmin list queues name | grep myapp_
```

### 3. Check Queue Details

```bash
# Get details of a specific queue
rabbitmqadmin show queue name=myapp_process-payment-activity_execute
```

## Message Flow

### Execute Flow Example

When a routing slip executes `ProcessPayment` activity:

1. **DistributedExecutor** publishes `RoutingSlipActivityExecuteMessage` to `myapp_process-payment-activity_execute`
2. **Consumer** (auto-generated) receives the message
3. **ProcessPaymentActivity.execute()** is invoked
4. **Response** message is published back (request/reply pattern)

### Compensate Flow Example

When compensation is needed for `ProcessPayment`:

1. **DistributedExecutor** publishes `RoutingSlipActivityCompensateMessage` to `myapp_process-payment-activity_compensate`
2. **Compensate Consumer** receives the message
3. **ProcessPaymentActivity.compensate()** is invoked
4. **Response** message is published back

## Monitoring Queue Activity

### View Messages

In RabbitMQ Management UI:
1. Click on a queue name
2. Scroll to **Get messages** section
3. Click **Get Message(s)** to preview messages

### Queue Statistics

Monitor:
- **Ready**: Messages waiting to be consumed
- **Unacked**: Messages being processed
- **Total**: Total messages in queue
- **Rate**: Message throughput

### Consumer Count

Each queue should show:
- **Consumers**: 1 (the auto-generated consumer)
- If 0, check that the application is running and connected

## Troubleshooting

### Queues Not Created

**Symptom**: Queues don't appear in RabbitMQ after starting the application.

**Possible Causes**:
1. Application not connected to RabbitMQ
2. Activities not registered with `RoutingSlipBusConfigurator`
3. RabbitMQ connection error

**Solution**:
```bash
# Check application logs
npm run start:dev

# Look for:
# [RoutingSlipBusConfigurator] Registering routing slip activities...
# [RabbitMQ] Connected to broker...
```

### No Consumers on Queues

**Symptom**: Queues exist but show 0 consumers.

**Possible Causes**:
1. Consumer registration failed
2. Activity class not in DI container

**Solution**:
- Ensure activities are in `providers` array in `app.module.ts`
- Check for errors during consumer registration

### Messages Stuck in Queue

**Symptom**: Messages stay in "Ready" state and aren't consumed.

**Possible Causes**:
1. Consumer error/exception
2. Message format mismatch
3. Activity not found

**Solution**:
- Check application logs for consumer errors
- Verify message structure matches expected format
- Ensure activity is registered in `RoutingSlipActivityFactory`

## Configuration in Code

The queue registration happens in:

**File**: `src/infrastructure/_core/messaging/messaging.module.ts`

```typescript
@Module({
    imports: [
        BusTransit.AddBusTransit.setUp((x) => {
            // ... other consumers ...

            // Configure Routing Slip Activities
            RoutingSlipBusConfigurator.configure(x, {
                queuePrefix: 'myapp',
                activities: [
                    ProcessPaymentActivity,
                    ReserveInventoryActivity,
                    SendConfirmationActivity,
                    ValidateInventoryActivity
                ]
            });

            x.UsingRabbitMq(configService.get('APP_NAME'), (context, cfg) => {
                cfg.Host(/* ... */);

                // ... other endpoints ...

                // Configure Routing Slip Activity Endpoints
                RoutingSlipBusConfigurator.configureEndpoints(cfg, context, {
                    queuePrefix: 'myapp',
                    activities: [
                        ProcessPaymentActivity,
                        ReserveInventoryActivity,
                        SendConfirmationActivity,
                        ValidateInventoryActivity
                    ]
                });
            });
        })
    ]
})
```

## Changing Queue Prefix

To change the queue prefix, update both calls:

```typescript
// Change 'myapp' to your desired prefix
RoutingSlipBusConfigurator.configure(x, {
    queuePrefix: 'your-prefix',  // <-- Change here
    activities: [/* ... */]
});

RoutingSlipBusConfigurator.configureEndpoints(cfg, context, {
    queuePrefix: 'your-prefix',  // <-- And here
    activities: [/* ... */]
});
```

New queues will be:
- `your-prefix_process-payment-activity_execute`
- `your-prefix_process-payment-activity_compensate`
- etc.

## Testing Queue Creation

### 1. Start RabbitMQ

```bash
# Using Docker
docker run -d --name rabbitmq \
  -p 5672:5672 \
  -p 15672:15672 \
  rabbitmq:3-management

# Or use your existing RabbitMQ instance
```

### 2. Start the Application

```bash
npm run start:dev
```

### 3. Watch the Logs

Look for queue creation logs:
```
[RoutingSlipBusConfigurator] Configuring routing slip activities...
[RoutingSlipBusConfigurator] Registered execute consumer: ProcessPaymentActivity
[RoutingSlipBusConfigurator] Registered compensate consumer: ProcessPaymentActivity
[RoutingSlipBusConfigurator] Registered execute consumer: ReserveInventoryActivity
...
```

### 4. Verify in RabbitMQ UI

Open http://localhost:15672 and check the Queues tab.

### 5. Test by Executing a Routing Slip

```bash
curl http://localhost:3000/test-routing-slip
```

Watch the messages flow through the queues in RabbitMQ Management UI.

## Next Steps

- Monitor queue depths to ensure no backlog
- Set up alerts for queue depths exceeding thresholds
- Configure dead letter queues for failed messages
- Implement retry policies for transient failures
- Add distributed tracing to track messages across queues

## Related Documentation

- [Routing Slip Distributed Mode](../../ROUTING_SLIP_DISTRIBUTED_MODE.md)
- [Routing Slip Example](./ROUTING_SLIPS_EXAMPLE.md)
- [Routing Slip Configuration Guide](../../ROUTING_SLIPS_Configure.md)
