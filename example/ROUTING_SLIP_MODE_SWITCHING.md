# Switching Between InProcess and Distributed Modes

This guide explains how to switch between InProcess and Distributed execution modes for routing slips.

## Overview

The routing slip implementation supports two modes:

1. **InProcess Mode** (default) - Activities execute directly, no queues
2. **Distributed Mode** - Activities execute via RabbitMQ queues

## Mode Configuration

Both configurations must be aligned for the system to work correctly:

### Configuration Points

1. **app.module.ts** - `RoutingSlipModule.forRoot()` execution mode
2. **.env file** - `ROUTING_SLIP_MODE` environment variable
3. **messaging.module.ts** - Consumer registration (automatic based on .env)

## InProcess Mode (Default)

### When to Use

- ✅ All activities are in the same service
- ✅ Low latency is critical
- ✅ Simple deployment
- ✅ No message broker overhead needed
- ✅ Development and testing

### Configuration

#### 1. app.module.ts

```typescript
RoutingSlipModule.forRoot({
  executionMode: RoutingSlipExecutionMode.InProcess,
  enableEventSubscribers: true
})
```

#### 2. .env (or .env.development)

```bash
# InProcess mode - no consumers needed
ROUTING_SLIP_MODE=inprocess
```

Or leave it empty:
```bash
# ROUTING_SLIP_MODE=
```

### What Happens in InProcess Mode

1. ❌ No RabbitMQ queues created for activities
2. ❌ No consumers registered
3. ✅ Activities execute via direct method calls
4. ✅ Fast execution (<1ms per activity)
5. ✅ Simple debugging

### Expected Logs on Startup

```
[RoutingSlip] Using InProcess mode - consumers disabled
[RoutingSlipService] RoutingSlipService initialized in IN-PROCESS mode
```

### Testing InProcess Mode

```bash
# Start the application
npm run start:dev

# Execute routing slip
curl http://localhost:3000/test-routing-slip

# Check logs - you should see:
# [ProcessPayment] Processing payment for order...
# [ReserveInventory] Reserving inventory for order...
# [SendConfirmation] Sending confirmation for order...
# [EVENT] Routing slip completed: ... (370ms)
```

## Distributed Mode

### When to Use

- ✅ Activities span multiple microservices
- ✅ Horizontal scaling needed
- ✅ Fault tolerance required
- ✅ Queue-based load balancing desired
- ✅ Long-running activities
- ✅ Production deployment with multiple instances

### Configuration

#### 1. app.module.ts

**Comment out InProcess config and uncomment Distributed:**

```typescript
// InProcess Mode (comment this out)
// RoutingSlipModule.forRoot({
//   executionMode: RoutingSlipExecutionMode.InProcess,
//   enableEventSubscribers: true
// }),

// Distributed Mode (uncomment this)
RoutingSlipModule.forRoot({
  executionMode: RoutingSlipExecutionMode.Distributed,
  queuePrefix: 'myapp',
  autoProvisionQueues: true
})
```

#### 2. .env (or .env.development)

```bash
# Distributed mode - enable consumers
ROUTING_SLIP_MODE=distributed
```

#### 3. Ensure RabbitMQ is Running

```bash
# Using Docker
docker run -d --name rabbitmq \
  -p 5672:5672 \
  -p 15672:15672 \
  rabbitmq:3-management
```

Or configure existing RabbitMQ in .env:

```bash
RMQ_HOST=localhost
RMQ_VHOST=bustransit
RMQ_USERNAME=guest
RMQ_PASSWORD=guest
```

### What Happens in Distributed Mode

1. ✅ RabbitMQ queues created for each activity
2. ✅ Consumers registered and listening
3. ✅ Messages sent to execute queues
4. ✅ Activities invoked when messages received
5. ⚠️ Uses in-process fallback for responses (current implementation)

### Expected Logs on Startup

```
[RoutingSlip] Configuring distributed mode consumers...
[RoutingSlip] Configuring distributed mode endpoints...
[RoutingSlipService] RoutingSlipService initialized in DISTRIBUTED mode
[RabbitMQ] Connected to broker...
[RabbitMQ] Queue created: myapp_process-payment-activity_execute
[RabbitMQ] Queue created: myapp_process-payment-activity_compensate
[RabbitMQ] Queue created: myapp_reserve-inventory-activity_execute
[RabbitMQ] Queue created: myapp_reserve-inventory-activity_compensate
[RabbitMQ] Queue created: myapp_send-confirmation-activity_execute
[RabbitMQ] Queue created: myapp_validate-inventory-activity_execute
[RabbitMQ] Queue created: myapp_validate-inventory-activity_compensate
```

### Verify in RabbitMQ Management UI

1. Open http://localhost:15672
2. Login (guest/guest)
3. Go to **Queues** tab
4. Look for queues starting with `myapp_`

You should see **7 queues**:
- `myapp_process-payment-activity_execute`
- `myapp_process-payment-activity_compensate`
- `myapp_reserve-inventory-activity_execute`
- `myapp_reserve-inventory-activity_compensate`
- `myapp_send-confirmation-activity_execute`
- `myapp_validate-inventory-activity_execute`
- `myapp_validate-inventory-activity_compensate`

### Testing Distributed Mode

```bash
# Start the application
npm run start:dev

# Execute routing slip
curl http://localhost:3000/test-routing-slip

# Check RabbitMQ UI - Messages tab
# You should see messages flowing through the queues

# Check application logs:
# [DRS] Starting distributed routing slip execution: ...
# [DRS] Sending execute message to queue [1/3]: myapp_process-payment-activity_execute
# [ProcessPaymentActivityExecuteConsumer] Received execute request for activity: ProcessPayment
# [ProcessPayment] Processing payment for order...
# ...
```

## Switching Modes

### From InProcess → Distributed

1. **Update .env**:
   ```bash
   ROUTING_SLIP_MODE=distributed
   ```

2. **Update app.module.ts**:
   ```typescript
   // Comment out InProcess
   // RoutingSlipModule.forRoot({
   //   executionMode: RoutingSlipExecutionMode.InProcess,
   //   ...
   // }),

   // Uncomment Distributed
   RoutingSlipModule.forRoot({
     executionMode: RoutingSlipExecutionMode.Distributed,
     queuePrefix: 'myapp',
     autoProvisionQueues: true
   })
   ```

3. **Start RabbitMQ** (if not running)

4. **Restart the application**:
   ```bash
   npm run start:dev
   ```

5. **Verify queues created** in RabbitMQ UI

### From Distributed → InProcess

1. **Update .env**:
   ```bash
   ROUTING_SLIP_MODE=inprocess
   ```
   Or remove the line entirely.

2. **Update app.module.ts**:
   ```typescript
   // Uncomment InProcess
   RoutingSlipModule.forRoot({
     executionMode: RoutingSlipExecutionMode.InProcess,
     enableEventSubscribers: true
   }),

   // Comment out Distributed
   // RoutingSlipModule.forRoot({
   //   executionMode: RoutingSlipExecutionMode.Distributed,
   //   ...
   // })
   ```

3. **Restart the application**:
   ```bash
   npm run start:dev
   ```

4. **Queues remain in RabbitMQ** but are not used (they can be deleted if desired)

## Common Issues

### Issue: Consumers registered but using InProcess mode

**Symptom**:
```
[RoutingSlip] Configuring distributed mode consumers...
[RoutingSlipService] RoutingSlipService initialized in IN-PROCESS mode
```

**Cause**: Mismatch between .env and app.module.ts

**Fix**: Ensure both are set to the same mode

---

### Issue: No queues created in Distributed mode

**Symptom**: Distributed mode configured but no queues in RabbitMQ

**Possible Causes**:
1. `ROUTING_SLIP_MODE=distributed` not set in .env
2. RabbitMQ not running
3. Connection error

**Fix**:
1. Check .env file
2. Start RabbitMQ
3. Check RabbitMQ connection settings
4. Look for connection errors in logs

---

### Issue: Activities not executing

**Symptom**: Routing slip times out or does nothing

**InProcess Mode**:
- Check that activities are registered in providers
- Verify activities have @RoutingSlipActivity decorator

**Distributed Mode**:
- Check queues exist in RabbitMQ
- Verify consumers are connected (1 consumer per queue)
- Check for consumer errors in logs

## Environment-Specific Configuration

### Development (.env.development)

```bash
ROUTING_SLIP_MODE=inprocess
```

Faster development, easier debugging.

### Staging (.env.staging)

```bash
ROUTING_SLIP_MODE=distributed
```

Test distributed behavior before production.

### Production (.env.production)

```bash
ROUTING_SLIP_MODE=distributed
```

Use distributed mode for scalability and fault tolerance.

## Quick Reference

| Aspect | InProcess | Distributed |
|--------|-----------|-------------|
| **.env** | `inprocess` or empty | `distributed` |
| **app.module.ts** | `InProcess` | `Distributed` |
| **Queues** | None | 7 queues |
| **Consumers** | None | 7 consumers |
| **Speed** | Fast (~ms) | Slower (~100ms+) |
| **Scaling** | Single instance | Multiple instances |
| **RabbitMQ** | Not required | Required |

## Testing Both Modes

### Test Script

```bash
#!/bin/bash

echo "Testing InProcess Mode..."
export ROUTING_SLIP_MODE=inprocess
npm run start:dev &
sleep 5
curl http://localhost:3000/test-routing-slip
killall node

echo "Testing Distributed Mode..."
export ROUTING_SLIP_MODE=distributed
npm run start:dev &
sleep 5
curl http://localhost:3000/test-routing-slip
killall node
```

## Summary

The key to switching modes is ensuring **both configurations are aligned**:

1. ✅ Set `ROUTING_SLIP_MODE` in .env
2. ✅ Update `RoutingSlipModule.forRoot()` in app.module.ts
3. ✅ Restart the application

The messaging module automatically detects the mode from the environment variable and registers consumers accordingly.
