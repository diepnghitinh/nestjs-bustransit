# Routing Slips Pattern Implementation Summary

## Overview
Successfully implemented the **Routing Slips Pattern** for the NestJS BusTransit library, based on [MassTransit's Routing Slips](https://masstransit.io/documentation/concepts/routing-slips) concept. This provides an activity-based approach to distributed transaction coordination with automatic compensation.

## What Was Implemented

### 1. Core Interfaces and Types

#### `/lib/interfaces/routing-slip.interface.ts`
Core routing slip data structures:
- `IRoutingSlip` - Main routing slip with tracking number, itinerary, variables, logs
- `IRoutingSlipActivity` - Activity specification in the itinerary
- `IRoutingSlipVariable` - Key-value variables shared between activities
- `IActivityLog` - Execution log for completed activities
- `IActivityException` - Exception information for faulted activities
- `IRoutingSlipItinerary` - Itinerary builder interface

#### `/lib/interfaces/activity.interface.ts`
Activity interfaces based on MassTransit's design:
- `IActivity<TArguments, TLog>` - Full activity with compensation support
- `IExecuteActivity<TArguments>` - Execute-only activity without compensation
- `IExecuteContext<TArguments>` - Context provided during activity execution
- `ICompensateContext<TLog>` - Context provided during compensation
- `IActivityResult` - Result type (Complete, Fault, Terminate)
- `ActivityResultType` - Enum for result types
- `IActivityFactory` - Factory interface for creating activities

#### `/lib/interfaces/routing-slip.events.ts`
Comprehensive event system for monitoring:
- `IRoutingSlipCompleted` - Routing slip completed successfully
- `IRoutingSlipFaulted` - Routing slip faulted with exceptions
- `IRoutingSlipCompensationFailed` - Compensation process failed
- `IRoutingSlipActivityCompleted` - Individual activity completed
- `IRoutingSlipActivityFaulted` - Individual activity faulted
- `IRoutingSlipActivityCompensated` - Individual activity compensated
- `IRoutingSlipTerminated` - Routing slip terminated gracefully
- `IRoutingSlipEventSubscriber` - Subscriber interface for all events

### 2. Core Implementation

#### `/lib/factories/routing-slip.builder.ts`
Fluent API for building routing slips:
```typescript
class RoutingSlipBuilder {
    addActivity(name, address, args)     // Add activity to itinerary
    addVariable(key, value)               // Add variable
    addVariables(variables)               // Add multiple variables
    setTrackingNumber(trackingNumber)     // Set custom tracking number
    build()                               // Build the routing slip
}
```

Features:
- Automatic tracking number generation (UUID v4)
- Fluent chaining API
- Validation (at least one activity required)
- Immutable build output

#### `/lib/factories/execute.context.ts`
Context implementations for activities:

**ExecuteContext**:
- Provides tracking number, arguments, and variables to activities
- Methods: `completed()`, `completedWithVariables()`, `faulted()`, `terminated()`
- Handles variable merging and result creation

**CompensateContext**:
- Provides tracking number, compensation log, and variables
- Used during compensation phase

#### `/lib/factories/routing-slip.executor.ts`
Main execution engine with automatic compensation:

**Features**:
- Sequential activity execution following the itinerary
- Automatic compensation in reverse order (LIFO) on failure
- Variable passing between activities
- Comprehensive event emission
- Error handling and logging
- Type-safe activity resolution

**Execution Flow**:
1. Iterate through itinerary activities
2. Create activity instance via factory
3. Create execution context with arguments and variables
4. Execute activity
5. Handle result (Complete/Fault/Terminate)
6. Log activity execution
7. Merge variables for next activity
8. Emit events
9. On fault: trigger compensation

**Compensation Flow**:
1. Reverse activity logs (LIFO)
2. For each logged activity with compensation support:
   - Create compensate context
   - Execute compensation
   - Log compensation
   - Emit events
3. Continue despite individual compensation failures

### 3. Example Implementation

#### Activity Examples

**`/example/src/infrastructure/messaging/routing-slips/activities/ProcessPaymentActivity.ts`**
- Full activity with compensation
- Processes payment and stores payment intent ID
- Compensates by refunding payment
- Demonstrates variable storage and usage

**`/example/src/infrastructure/messaging/routing-slips/activities/ReserveInventoryActivity.ts`**
- Full activity with compensation
- Reserves inventory and stores reservation ID
- Compensates by releasing inventory
- Demonstrates item-based operations

**`/example/src/infrastructure/messaging/routing-slips/activities/SendConfirmationActivity.ts`**
- Execute-only activity (no compensation)
- Sends confirmation email
- Demonstrates accessing variables from previous activities
- Shows when compensation is not appropriate

#### Supporting Services

**`/example/src/infrastructure/messaging/routing-slips/OrderActivityFactory.ts`**
- Activity factory implementation
- Registers activities in a map
- Provides activity instances to executor
- Uses dependency injection

**`/example/src/infrastructure/messaging/routing-slips/OrderProcessingService.ts`**
- Complete service example
- Builds routing slips using fluent API
- Executes routing slips
- Subscribes to all events
- Demonstrates real-world usage

### 4. Documentation

#### `/ROUTING_SLIPS.md`
Comprehensive documentation including:
- Overview of routing slips pattern
- Key concepts and terminology
- Comparison: Routing Slips vs Saga Compensation
- Core components with examples
- Complete usage examples
- Best practices
- Advanced patterns
- Troubleshooting guide
- Migration guide from saga compensation

#### Updated `/README.md`
- Added routing slips to roadmap (marked as completed)
- Added routing slips section with overview
- Included quick example
- Comparison with saga compensation
- Link to detailed documentation

## Architecture

### Pattern Design

The implementation follows MassTransit's routing slips architecture:

```
RoutingSlip (Document)
├── TrackingNumber (UUID)
├── Itinerary (Activities to execute)
│   ├── Activity 1 (name, address, arguments)
│   ├── Activity 2 (name, address, arguments)
│   └── Activity N (name, address, arguments)
├── Variables (Shared data)
│   ├── var1: value1
│   └── var2: value2
├── ActivityLogs (Execution history)
│   ├── Log 1 (name, timestamp, duration, compensation log)
│   └── Log 2 (name, timestamp, duration, compensation log)
└── CompensateLogs (Compensation history)
```

### Execution Flow

**Success Path**:
```
Build Routing Slip
    ↓
Execute Activity 1 → Store Variables → Log Execution
    ↓
Execute Activity 2 → Merge Variables → Log Execution
    ↓
Execute Activity N → Merge Variables → Log Execution
    ↓
Emit RoutingSlipCompleted
```

**Failure Path with Compensation**:
```
Execute Activity 1 → Success → Log with Compensation Data
    ↓
Execute Activity 2 → Success → Log with Compensation Data
    ↓
Execute Activity 3 → FAULT → Store Exception
    ↓
Reverse Activity Logs (LIFO)
    ↓
Compensate Activity 2 → Success → Log Compensation
    ↓
Compensate Activity 1 → Success → Log Compensation
    ↓
Emit RoutingSlipFaulted
```

## Key Differences from Saga Compensation

| Aspect | Routing Slips | Saga Compensation |
|--------|--------------|-------------------|
| **Pattern** | Activity-based coordination | Event-driven state machine |
| **Coupling** | Loose - Activities are independent | Tight - Tied to saga workflow |
| **Reusability** | High - Activities reusable across workflows | Low - Compensations specific to saga |
| **Compensation Trigger** | Automatic on activity fault | Manual via `Compensate(ctx)` |
| **Data Flow** | Variables map between activities | Saga state object |
| **Dynamic Workflows** | Yes - Itinerary can be revised | No - Fixed state machine |
| **State Persistence** | Not required | Required for long-running sagas |
| **Use Case** | Multi-service orchestration | Complex business processes |

## Usage Example

```typescript
// 1. Define activities
@Injectable()
export class ProcessPaymentActivity implements IActivity<PaymentArgs, PaymentLog> {
    name = 'ProcessPayment';

    async execute(context: IExecuteContext<PaymentArgs>) {
        const paymentId = await this.processPayment(context.arguments);
        return context.completedWithVariables(
            new Map([['paymentId', paymentId]]),
            { paymentId, amount: context.arguments.amount }
        );
    }

    async compensate(context: ICompensateContext<PaymentLog>) {
        await this.refundPayment(context.compensationLog.paymentId);
    }
}

// 2. Create factory
@Injectable()
export class ActivityFactory implements IActivityFactory {
    createActivity(name: string) {
        return this.activities.get(name);
    }
}

// 3. Build and execute routing slip
const routingSlip = RoutingSlipBuilder.create('order-123')
    .addActivity('ProcessPayment', 'payment-service', { amount: 99.99 })
    .addActivity('ReserveInventory', 'inventory-service', { items: [...] })
    .addVariable('orderId', 'order-123')
    .build();

const executor = new RoutingSlipExecutor(activityFactory);
await executor.execute(routingSlip);
```

## Benefits

1. **Loose Coupling**: Activities are independent, reusable components
2. **Automatic Compensation**: No need to manually track or trigger compensations
3. **Rich Events**: Comprehensive monitoring and observability
4. **Dynamic Workflows**: Build itineraries at runtime based on conditions
5. **Type Safety**: Full TypeScript support with generics
6. **Flexible**: Mix compensatable and non-compensatable activities
7. **Testable**: Activities can be unit tested independently
8. **Scalable**: Activities can run on different services

## Best Practices

1. **Activity Design**
   - Single responsibility per activity
   - Idempotent execution and compensation
   - Stateless activity instances
   - Comprehensive error handling

2. **Compensation**
   - Always log enough data for compensation
   - Handle compensation failures gracefully
   - Design for eventual consistency
   - Make compensations idempotent

3. **Variables**
   - Use for sharing data between activities
   - Keep variable data minimal
   - Treat as immutable (create new maps when updating)

4. **Error Handling**
   - Log all errors comprehensively
   - Use `faulted()` for expected failures
   - Let unexpected errors bubble up
   - Monitor compensation events

5. **Testing**
   - Unit test activities independently
   - Integration test routing slip execution
   - Test compensation scenarios
   - Mock activity factory in tests

## Files Created/Modified

### New Files
- `/lib/interfaces/routing-slip.interface.ts`
- `/lib/interfaces/activity.interface.ts`
- `/lib/interfaces/routing-slip.events.ts`
- `/lib/factories/routing-slip.builder.ts`
- `/lib/factories/execute.context.ts`
- `/lib/factories/routing-slip.executor.ts`
- `/example/src/infrastructure/messaging/routing-slips/activities/ProcessPaymentActivity.ts`
- `/example/src/infrastructure/messaging/routing-slips/activities/ReserveInventoryActivity.ts`
- `/example/src/infrastructure/messaging/routing-slips/activities/SendConfirmationActivity.ts`
- `/example/src/infrastructure/messaging/routing-slips/OrderActivityFactory.ts`
- `/example/src/infrastructure/messaging/routing-slips/OrderProcessingService.ts`
- `/ROUTING_SLIPS.md`
- `/ROUTING_SLIPS_IMPLEMENTATION_SUMMARY.md`

### Modified Files
- `/README.md` - Added routing slips section and roadmap item

## Dependencies

The implementation uses:
- `uuid` (v4) - For generating tracking numbers
- `@nestjs/common` - Logger and Injectable decorator
- TypeScript generics for type safety

## Next Steps

To use the routing slips pattern in your application:

1. **Install dependencies**: Ensure `uuid` package is installed
2. **Define activities**: Create activity classes implementing `IActivity` or `IExecuteActivity`
3. **Create factory**: Implement `IActivityFactory` to provide activity instances
4. **Build routing slips**: Use `RoutingSlipBuilder` to create routing slips
5. **Execute**: Use `RoutingSlipExecutor` to execute routing slips
6. **Monitor**: Subscribe to events for observability
7. **Test**: Write tests for activities and routing slip scenarios

## Backward Compatibility

- Existing saga compensation functionality remains unchanged
- Both patterns can coexist in the same application
- No breaking changes to existing APIs
- Routing slips are a completely separate pattern

## Technical Notes

- Activities are resolved via factory pattern for dependency injection
- Compensation executes in reverse order (LIFO - Last In, First Out)
- Variables are immutable between activities (new Map created on each merge)
- Type guards used for checking compensatable activities
- Comprehensive logging at all stages for debugging
- Event system allows for custom monitoring and integration
- Tracking numbers are UUIDs by default but can be customized
- All async operations properly awaited
- Error handling preserves stack traces

## Comparison with MassTransit

This implementation closely follows MassTransit's design:

✅ **Implemented**:
- Activity-based pattern
- Compensation in reverse order
- Variable passing
- Execute and compensate contexts
- Result types (Complete, Fault, Terminate)
- Event system
- Tracking numbers
- Activity logs

⚠️ **Simplified** (appropriate for NestJS):
- No distributed execution (activities run locally via factory)
- No message-based activity invocation
- Simplified event publishing (in-memory subscribers)
- No itinerary revision support yet

📋 **Future Enhancements**:
- Distributed activity execution via message bus
- Persistent routing slip state
- Itinerary revision at runtime
- Activity timeout support
- Retry policies for activities
