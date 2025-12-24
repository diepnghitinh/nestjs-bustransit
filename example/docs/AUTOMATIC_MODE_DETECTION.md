# Automatic Mode Detection for Routing Slips

The routing slip system **automatically detects the execution mode** and only registers consumers when needed.

## How It Works

### Single Configuration Point

You only need to configure the mode in **ONE file**: `src/routing-slip.config.ts`

```typescript
// src/routing-slip.config.ts
import { RoutingSlipExecutionMode, RoutingSlipModeRegistry } from 'nestjs-bustransit';

// Choose your execution mode:

// InProcess Mode (default):
RoutingSlipModeRegistry.setMode(RoutingSlipExecutionMode.InProcess);

// OR

// Distributed Mode:
// RoutingSlipModeRegistry.setMode(RoutingSlipExecutionMode.Distributed, 'myapp');
```

### How It Works Internally

1. **Early Initialization**: The `routing-slip.config.ts` file is imported FIRST in `app.module.ts`:
   ```typescript
   // app.module.ts
   import './routing-slip.config';  // ← Must be first!
   import { Module } from '@nestjs/common';
   // ... other imports
   ```

2. **Mode Registration**: The mode is set globally BEFORE any modules load

3. **Automatic Detection**: When `RoutingSlipBusConfigurator` runs, it checks the mode:
   - **InProcess**: Skips consumer registration entirely
   - **Distributed**: Registers consumers and configures endpoints

4. **No Manual Changes Needed**: The `messaging.module.ts` code stays the same for both modes!

## That's It!

You **only need to change** the mode in `routing-slip.config.ts`. Everything else happens automatically!

## Switching Modes

### From InProcess → Distributed

**src/routing-slip.config.ts:**
```typescript
// Comment out InProcess
// RoutingSlipModeRegistry.setMode(RoutingSlipExecutionMode.InProcess);

// Uncomment Distributed
RoutingSlipModeRegistry.setMode(RoutingSlipExecutionMode.Distributed, 'myapp');
```

**Result:**
- ✅ 7 routing slip activity consumers registered
- ✅ 7 queues created in RabbitMQ
- ✅ Activities execute via message queues

### From Distributed → InProcess

**src/routing-slip.config.ts:**
```typescript
// Uncomment InProcess
RoutingSlipModeRegistry.setMode(RoutingSlipExecutionMode.InProcess);

// Comment out Distributed
// RoutingSlipModeRegistry.setMode(RoutingSlipExecutionMode.Distributed, 'myapp');
```

**Result:**
- ✅ No routing slip consumers registered
- ✅ No routing slip queues created
- ✅ Activities execute directly

## Testing Modes

### Test InProcess Mode

**src/routing-slip.config.ts:**
```typescript
RoutingSlipModeRegistry.setMode(RoutingSlipExecutionMode.InProcess);
```

**Start the app:**
```bash
npm run start:dev
```

**Expected logs:**
```
[RoutingSlipBusConfigurator] InProcess mode detected - skipping consumer registration
[RoutingSlipBusConfigurator] Consumers are only registered in Distributed mode
[RoutingSlipBusConfigurator] InProcess mode detected - skipping endpoint configuration
[RoutingSlipService] RoutingSlipService initialized in IN-PROCESS mode
```

**Result:**
- ✅ No routing slip consumers registered
- ✅ No routing slip queues created
- ✅ Activities execute directly
- ✅ Regular saga consumers still work

### Test Distributed Mode

**src/routing-slip.config.ts:**
```typescript
RoutingSlipModeRegistry.setMode(RoutingSlipExecutionMode.Distributed, 'myapp');
```

**Start the app:**
```bash
npm run start:dev
```

**Expected logs:**
```
[RoutingSlipBusConfigurator] Distributed mode detected - registering activity consumers...
[RoutingSlipBusConfigurator]   ✓ Registered execute consumer: ProcessPaymentActivity
[RoutingSlipBusConfigurator]   ✓ Registered compensate consumer: ProcessPaymentActivity
[RoutingSlipBusConfigurator]   ✓ Registered execute consumer: ReserveInventoryActivity
[RoutingSlipBusConfigurator]   ✓ Registered compensate consumer: ReserveInventoryActivity
[RoutingSlipBusConfigurator]   ✓ Registered execute consumer: SendConfirmationActivity
[RoutingSlipBusConfigurator]   ✓ Registered execute consumer: ValidateInventoryActivity
[RoutingSlipBusConfigurator]   ✓ Registered compensate consumer: ValidateInventoryActivity
[RoutingSlipBusConfigurator] Consumer registration complete - 4 activities configured
[RoutingSlipBusConfigurator] Distributed mode detected - configuring RabbitMQ endpoints...
[RoutingSlipBusConfigurator] Endpoint configuration complete - 4 activities configured
[RoutingSlipService] RoutingSlipService initialized in DISTRIBUTED mode
Started Consumer ProcessPaymentActivityExecuteConsumer <- myapp_process-payment-activity_execute
Started Consumer ProcessPaymentActivityCompensateConsumer <- myapp_process-payment-activity_compensate
Started Consumer ReserveInventoryActivityExecuteConsumer <- myapp_reserve-inventory-activity_execute
Started Consumer ReserveInventoryActivityCompensateConsumer <- myapp_reserve-inventory-activity_compensate
Started Consumer SendConfirmationActivityExecuteConsumer <- myapp_send-confirmation-activity_execute
Started Consumer ValidateInventoryActivityExecuteConsumer <- myapp_validate-inventory-activity_execute
Started Consumer ValidateInventoryActivityCompensateConsumer <- myapp_validate-inventory-activity_compensate
```

**Result:**
- ✅ 7 routing slip consumers registered
- ✅ 7 routing slip queues created
- ✅ Activities execute via message queues
- ✅ Regular saga consumers still work

## Benefits

### ✅ Single Source of Truth

Only change the mode in **one file**: `src/routing-slip.config.ts`

### ✅ No Manual Commenting/Uncommenting

The `messaging.module.ts` code stays exactly the same - it auto-detects!

### ✅ Clear Logs

Know exactly what's happening based on the log output

### ✅ No Configuration Mismatch

Can't accidentally have consumers enabled in InProcess mode or disabled in Distributed mode

### ✅ Fast Mode Switching

Just uncomment/comment one line and restart

## Summary

| Mode | src/routing-slip.config.ts | messaging.module.ts | Result |
|------|---------------------------|---------------------|--------|
| InProcess | `InProcess` | **No change** | Consumers skipped |
| Distributed | `Distributed` + prefix | **No change** | Consumers registered |

**The key**: You only configure the mode in `src/routing-slip.config.ts`. The rest is automatic! 🎉
