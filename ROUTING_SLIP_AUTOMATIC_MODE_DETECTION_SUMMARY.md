# Routing Slip Automatic Mode Detection - Implementation Summary

## Problem Solved

The user requested that routing slip activity consumers should **only start when using Distributed mode**, not when using InProcess mode. This required implementing automatic mode detection so users don't need to manually comment/uncomment consumer registration code when switching modes.

## Solution Overview

Implemented a global mode registry pattern with early initialization to ensure the execution mode is set before BusTransit module initialization.

### Key Components

1. **RoutingSlipModeRegistry** (`lib/routing-slips/helpers/routing-slip-mode-detector.ts`)
   - Global static class that stores the execution mode
   - Provides `setMode()` and `isDistributedMode()` methods
   - Single source of truth for the current mode

2. **routing-slip.config.ts** (`example/src/routing-slip.config.ts`)
   - Imported FIRST in app.module.ts before any other imports
   - Sets the execution mode early in the module loading process
   - Single configuration point for users

3. **RoutingSlipBusConfigurator** (`lib/routing-slips/helpers/routing-slip-bus-configurator.ts`)
   - Automatically detects mode using `RoutingSlipModeRegistry.isDistributedMode()`
   - Skips consumer registration in InProcess mode
   - Registers consumers and configures endpoints in Distributed mode

## Implementation Details

### Fixed Issues

#### 1. Circular Import Issue
**Problem**: `RoutingSlipExecutionMode` enum caused circular dependency between `routing-slip.module.ts` and `routing-slip-mode-detector.ts`

**Solution**: Moved enum to `constants/routing-slip.constants.ts`

```typescript
// lib/constants/routing-slip.constants.ts
export enum RoutingSlipExecutionMode {
    InProcess = 'InProcess',
    Distributed = 'Distributed'
}
```

#### 2. Module Initialization Order
**Problem**: Even with `RoutingSlipModule` imported before `MessagingInfrastructureModule`, the `BusTransit.AddBusTransit.setUp()` callback executed before `RoutingSlipModule.forRoot()` could set the mode.

**Solution**: Created separate `routing-slip.config.ts` file that is imported as the FIRST statement in `app.module.ts`:

```typescript
// example/src/app.module.ts
import './routing-slip.config';  // ← Must be first!
import { Module } from '@nestjs/common';
// ... other imports
```

This ensures the mode is set during module file evaluation, before any dynamic module setup.

### How It Works

1. **Early Mode Set**: When `app.module.ts` is loaded, the first import `'./routing-slip.config'` executes and calls `RoutingSlipModeRegistry.setMode()`

2. **BusTransit Setup**: When `MessagingInfrastructureModule` loads and `BusTransit.AddBusTransit.setUp()` runs, it calls `RoutingSlipBusConfigurator.configure()`

3. **Mode Check**: The configurator calls `RoutingSlipModeRegistry.isDistributedMode()` to check the mode

4. **Conditional Registration**:
   - **InProcess mode**: Logs "InProcess mode detected - skipping consumer registration" and returns early
   - **Distributed mode**: Registers 7 consumers (4 execute + 3 compensate) and configures RabbitMQ endpoints

5. **Service Initialization**: Later, `RoutingSlipService` chooses the appropriate executor based on the mode

## User Experience

### Before (Manual Configuration)

```typescript
// messaging.module.ts - had to manually comment/uncomment
const enableRoutingSlipConsumers = process.env.ROUTING_SLIP_MODE === 'distributed';
if (enableRoutingSlipConsumers) {
    RoutingSlipBusConfigurator.configure(x, {...});
}
```

Problems:
- Required environment variable
- Required manual code changes
- Error-prone
- Configuration scattered across multiple files

### After (Automatic Detection)

```typescript
// src/routing-slip.config.ts - ONE file to change
RoutingSlipModeRegistry.setMode(RoutingSlipExecutionMode.InProcess);
// OR
// RoutingSlipModeRegistry.setMode(RoutingSlipExecutionMode.Distributed, 'myapp');
```

```typescript
// messaging.module.ts - ALWAYS the same (no changes needed)
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

Benefits:
- ✅ Single configuration point
- ✅ No environment variables needed
- ✅ No manual code changes
- ✅ Automatic consumer registration/skipping
- ✅ Clear logs showing what mode is active

## Verification

### InProcess Mode
```bash
# src/routing-slip.config.ts
RoutingSlipModeRegistry.setMode(RoutingSlipExecutionMode.InProcess);

# Logs:
[RoutingSlipBusConfigurator] InProcess mode detected - skipping consumer registration
[RoutingSlipBusConfigurator] Consumers are only registered in Distributed mode
[RoutingSlipBusConfigurator] InProcess mode detected - skipping endpoint configuration
[RoutingSlipService] RoutingSlipService initialized in IN-PROCESS mode

# Result: 0 routing slip consumers registered
```

### Distributed Mode
```bash
# src/routing-slip.config.ts
RoutingSlipModeRegistry.setMode(RoutingSlipExecutionMode.Distributed, 'myapp');

# Logs:
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

# Result: 7 routing slip consumers registered, 7 queues created
```

## Files Modified

### Library Files
1. `lib/constants/routing-slip.constants.ts` - Added `RoutingSlipExecutionMode` enum
2. `lib/routing-slips/helpers/routing-slip-mode-detector.ts` - Imports enum from constants
3. `lib/routing-slip.module.ts` - Imports enum from constants
4. `lib/services/routing-slip.service.ts` - Imports enum from constants
5. `lib/routing-slips/index.ts` - Exports enum from constants
6. `lib/index.ts` - Exports `RoutingSlipModeRegistry`

### Example Files
1. `example/src/routing-slip.config.ts` - **NEW** - Single configuration point
2. `example/src/app.module.ts` - Imports config file first
3. `example/AUTOMATIC_MODE_DETECTION.md` - Updated documentation

## Testing Results

✅ Library builds successfully (`npm run build`)
✅ Example builds successfully (`npm run build`)
✅ InProcess mode: No routing slip consumers start
✅ Distributed mode: 7 routing slip consumers start
✅ Mode switching: Works with single config file change
✅ Regular saga consumers: Unaffected by routing slip mode

## Conclusion

The automatic mode detection is fully functional and tested. Users can now switch between InProcess and Distributed execution modes by changing a single line in `src/routing-slip.config.ts`. The system automatically handles all consumer registration and queue configuration based on the selected mode.
