# Routing Slip Configuration Guide

This guide explains how to configure routing slips for InProcess or Distributed execution mode.

## Configuration Overview

Routing slip execution mode is configured in **TWO places** that must match:

1. **`app.module.ts`** - Choose execution mode (InProcess or Distributed)
2. **`messaging.module.ts`** - Enable/disable consumers (must match #1)

## InProcess Mode (Default - No Consumers)

Use this mode when all activities run in the same process. No RabbitMQ queues are created.

### Step 1: Configure app.module.ts

```typescript
// app.module.ts
RoutingSlipModule.forRoot({
  executionMode: RoutingSlipExecutionMode.InProcess,  // ← InProcess mode
  enableEventSubscribers: true
})
```

### Step 2: Disable Consumers in messaging.module.ts

**Keep the RoutingSlipBusConfigurator calls COMMENTED OUT:**

```typescript
// messaging.module.ts

// Configure Routing Slip Activities
// Uncomment ONLY when using Distributed mode

// RoutingSlipBusConfigurator.configure(x, {
//     queuePrefix: 'myapp',
//     activities: [...]
// });

// ...later in UsingRabbitMq...

// RoutingSlipBusConfigurator.configureEndpoints(cfg, context, {
//     queuePrefix: 'myapp',
//     activities: [...]
// });
```

### What Happens

- ✅ Activities execute via direct method calls
- ✅ Fast execution (<1ms per activity)
- ❌ No RabbitMQ queues created
- ❌ No consumers registered
- ✅ Simple debugging

### Expected Logs

```
[RoutingSlipService] RoutingSlipService initialized in IN-PROCESS mode
```

## Distributed Mode (Queue-Based Execution)

Use this mode for horizontal scaling, fault tolerance, or cross-service activities.

### Step 1: Configure app.module.ts

```typescript
// app.module.ts
RoutingSlipModule.forRoot({
  executionMode: RoutingSlipExecutionMode.Distributed,  // ← Distributed mode
  queuePrefix: 'myapp',
  autoProvisionQueues: true
})
```

### Step 2: Enable Consumers in messaging.module.ts

**UNCOMMENT the RoutingSlipBusConfigurator calls:**

```typescript
// messaging.module.ts

// Configure Routing Slip Activities
RoutingSlipBusConfigurator.configure(x, {
    queuePrefix: 'myapp',  // Must match app.module.ts
    activities: [
        ProcessPaymentActivity,
        ReserveInventoryActivity,
        SendConfirmationActivity,
        ValidateInventoryActivity
    ]
});

// ...later in UsingRabbitMq...

RoutingSlipBusConfigurator.configureEndpoints(cfg, context, {
    queuePrefix: 'myapp',  // Must match above
    activities: [
        ProcessPaymentActivity,
        ReserveInventoryActivity,
        SendConfirmationActivity,
        ValidateInventoryActivity
    ]
});
```

### Step 3: Ensure RabbitMQ is Running

```bash
docker run -d --name rabbitmq \
  -p 5672:5672 \
  -p 15672:15672 \
  rabbitmq:3-management
```

### What Happens

- ✅ 7 RabbitMQ queues created (execute + compensate)
- ✅ 7 consumers registered and listening
- ✅ Messages sent to queues for execution
- ✅ Horizontal scaling possible
- ⚠️ Slower than InProcess (~100ms+ per activity)

### Expected Logs

```
[RoutingSlipService] RoutingSlipService initialized in DISTRIBUTED mode
[RabbitMQ] Queue created: myapp_process-payment-activity_execute
[RabbitMQ] Queue created: myapp_process-payment-activity_compensate
[RabbitMQ] Queue created: myapp_reserve-inventory-activity_execute
[RabbitMQ] Queue created: myapp_reserve-inventory-activity_compensate
[RabbitMQ] Queue created: myapp_send-confirmation-activity_execute
[RabbitMQ] Queue created: myapp_validate-inventory-activity_execute
[RabbitMQ] Queue created: myapp_validate-inventory-activity_compensate
```

### Verify in RabbitMQ UI

1. Open http://localhost:15672
2. Login (guest/guest)
3. Go to Queues tab
4. Look for 7 queues starting with `myapp_`

## Quick Reference

| File | InProcess Mode | Distributed Mode |
|------|----------------|------------------|
| **app.module.ts** | `RoutingSlipExecutionMode.InProcess` | `RoutingSlipExecutionMode.Distributed` |
| **messaging.module.ts** | Configurator calls **commented** | Configurator calls **uncommented** |
| **RabbitMQ Queues** | 0 queues | 7 queues |
| **Consumers** | 0 consumers | 7 consumers |

## Common Configuration Mistakes

### ❌ Mistake 1: Mismatch Between Modules

**app.module.ts**: Uses `Distributed` mode
**messaging.module.ts**: Consumers commented out

**Result**: Executor tries to use queues but no consumers exist. Messages go nowhere.

**Fix**: Uncomment consumers in messaging.module.ts

---

### ❌ Mistake 2: Consumers Without Distributed Mode

**app.module.ts**: Uses `InProcess` mode
**messaging.module.ts**: Consumers uncommented

**Result**: Unnecessary queues created. Activities still execute in-process. Wasted resources.

**Fix**: Comment out consumers in messaging.module.ts

---

### ❌ Mistake 3: Wrong Queue Prefix

**app.module.ts**: `queuePrefix: 'myapp'`
**messaging.module.ts**: `queuePrefix: 'otherapp'`

**Result**: Queues created with wrong names. Executor can't find queues.

**Fix**: Use same prefix in both places

## Current Configuration Status

Based on your current files:

**app.module.ts** (lines 40-44):
```typescript
RoutingSlipModule.forRoot({
  executionMode: RoutingSlipExecutionMode.Distributed,  // ← DISTRIBUTED
  queuePrefix: 'myapp',
  autoProvisionQueues: true
})
```

**messaging.module.ts** (lines 55-63):
```typescript
// RoutingSlipBusConfigurator.configure(x, {  // ← COMMENTED OUT
//     queuePrefix: 'myapp',
//     activities: [...]
// });
```

**Status**: ⚠️ **MISMATCH**

**What Happens**:
- Executor is in Distributed mode
- No consumers registered
- Messages sent to queues but never processed
- Activities won't execute

**Fix**: Uncomment the configurator calls in messaging.module.ts

## Switching Modes

### From InProcess → Distributed

1. In `app.module.ts`:
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

2. In `messaging.module.ts`:
   ```typescript
   // Uncomment both calls
   RoutingSlipBusConfigurator.configure(x, {...});
   // ...
   RoutingSlipBusConfigurator.configureEndpoints(cfg, context, {...});
   ```

3. Restart the application

### From Distributed → InProcess

1. In `app.module.ts`:
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

2. In `messaging.module.ts`:
   ```typescript
   // Comment out both calls
   // RoutingSlipBusConfigurator.configure(x, {...});
   // ...
   // RoutingSlipBusConfigurator.configureEndpoints(cfg, context, {...});
   ```

3. Restart the application

## Testing Your Configuration

### Test InProcess Mode

```bash
# Start app
npm run start:dev

# Should see:
# [RoutingSlipService] RoutingSlipService initialized in IN-PROCESS mode

# Test
curl http://localhost:3000/test-routing-slip

# Activities execute directly (check logs)
```

### Test Distributed Mode

```bash
# Start RabbitMQ first
docker run -d --name rabbitmq -p 5672:5672 -p 15672:15672 rabbitmq:3-management

# Start app
npm run start:dev

# Should see:
# [RoutingSlipService] RoutingSlipService initialized in DISTRIBUTED mode
# [RabbitMQ] Queue created: myapp_process-payment-activity_execute
# ... (6 more queues)

# Test
curl http://localhost:3000/test-routing-slip

# Check RabbitMQ UI at http://localhost:15672
# Watch messages flow through queues
```

## Summary

**The key rule**: Both configurations must match!

| app.module.ts Mode | messaging.module.ts Consumers |
|-------------------|------------------------------|
| InProcess | Commented out ✅ |
| Distributed | Uncommented ✅ |

Always configure **both** consistently to avoid issues.
