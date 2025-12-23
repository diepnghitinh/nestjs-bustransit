# NestJS BusTransit Examples

This directory contains comprehensive examples demonstrating different distributed transaction patterns.

## Available Examples

### 1. Saga Pattern (`/test-saga`)
**Location**: `src/infrastructure/messaging/sagas/`

Classic saga pattern for orchestrating distributed transactions.

**Example**: Order Processing with Payment and Inventory
- State machine manages order lifecycle
- Consumers handle individual steps
- Automatic compensation on failure

**Endpoint**: `GET http://localhost:3000/test-saga`

**Key Files**:
- `OrderProcessingStateMachine.ts` - Saga state machine
- `ProcessPaymentConsumer.ts` - Payment processing
- `ReserveInventoryConsumer.ts` - Inventory reservation

**Learn More**: See code comments in saga files

---

### 2. Routing Slips Pattern (`/test-routing-slip`)
**Location**: `src/infrastructure/messaging/routing-slips/`

Routing slip pattern for multi-step operations with automatic compensation.

**Example**: Order Processing with Activities
- Activities execute in sequence
- Automatic LIFO compensation
- Variable sharing between activities

**Endpoints**:
- `GET http://localhost:3000/test-routing-slip` - Success path
- `GET http://localhost:3000/test-routing-slip-compensation` - Failure path
- `GET http://localhost:3000/test-routing-slip-failure-rate?rate=50` - Random failure

**Key Files**:
- `OrderProcessingService.ts` - Routing slip orchestration
- `ProcessPaymentActivity.ts` - Payment activity with compensation
- `ReserveInventoryActivity.ts` - Inventory activity with compensation
- `SendConfirmationActivity.ts` - Execute-only activity (no compensation)

**Learn More**: Check activity files for compensation examples

---

### 3. Hybrid Pattern - Saga + Routing Slips (`/test-hybrid-pattern`) ⭐
**Location**: `src/infrastructure/messaging/hybrid/`

**NEW**: Combines saga and routing slips for maximum power and flexibility.

**Example**: Order Fulfillment
- **Saga**: Manages high-level workflow (Submitted → Fulfilling → Shipping → Completed)
- **Routing Slip**: Handles complex fulfillment (Pick → Pack → Label → QualityCheck)

**Why Hybrid?**
- Saga provides workflow orchestration and state management
- Routing slip provides operational detail and compensation
- Clean separation of concerns
- Best of both patterns

**Endpoint**: `GET http://localhost:3000/test-hybrid-pattern`

**Key Files**:
- `OrderFulfillmentSaga.ts` - Saga managing order workflow
- `ExecuteFulfillmentConsumer.ts` - **Key integration point** - executes routing slip within saga
- `PickItemsActivity.ts` - Warehouse picking with compensation
- `PackItemsActivity.ts` - Package creation with compensation
- `GenerateShippingLabelActivity.ts` - Label generation with compensation
- `QualityCheckActivity.ts` - Quality inspection (can fail for demo)

**Learn More**: See [HYBRID_PATTERN_GUIDE.md](./HYBRID_PATTERN_GUIDE.md)

---

## Pattern Comparison

| Feature | Saga | Routing Slip | Hybrid |
|---------|------|--------------|--------|
| **Workflow orchestration** | ✅ Excellent | ❌ Limited | ✅ Excellent |
| **State persistence** | ✅ Yes | ❌ No | ✅ Yes (saga level) |
| **Fine-grained compensation** | ⚠️ Manual | ✅ Automatic | ✅ Automatic (routing slip level) |
| **Multi-step operations** | ⚠️ Verbose | ✅ Clean | ✅ Clean |
| **Complexity** | Medium | Low | Medium-High |
| **Best for** | Long workflows | Multi-step ops | Complex workflows with detailed operations |

## Quick Start

### 1. Start the application
```bash
cd example
npm install
npm run start:dev
```

### 2. Try the examples

**Saga Pattern**:
```bash
curl http://localhost:3000/test-saga
```

**Routing Slips - Success**:
```bash
curl http://localhost:3000/test-routing-slip
```

**Routing Slips - Compensation Demo**:
```bash
curl http://localhost:3000/test-routing-slip-compensation
```

**Routing Slips - Random Failure**:
```bash
# 50% chance of failure
curl http://localhost:3000/test-routing-slip-failure-rate?rate=50

# Always fails (100% rate)
curl http://localhost:3000/test-routing-slip-failure-rate?rate=100
```

**Hybrid Pattern** (Recommended):
```bash
curl http://localhost:3000/test-hybrid-pattern
```

### 3. Watch the logs

The console will show detailed execution flow including:
- State transitions
- Activity execution
- Compensation sequences
- Event notifications

## Architecture Visualizations

### Saga Pattern
```
OrderSubmitted Event
       ↓
   Saga State Machine (manages state)
       ↓
ProcessPayment Command → Consumer → PaymentProcessed Event
       ↓
   Saga transitions
       ↓
ReserveInventory Command → Consumer → InventoryReserved Event
       ↓
   Saga transitions
       ↓
   Completed
```

### Routing Slip Pattern
```
Order Request
       ↓
Routing Slip Builder
       ↓
┌─────────────────────────────────────┐
│  ProcessPayment (activity 1)        │
│  ↓ (variables shared)                │
│  ReserveInventory (activity 2)      │
│  ↓ (variables shared)                │
│  SendConfirmation (activity 3)      │
└─────────────────────────────────────┘
       ↓
If any fails → Compensation (LIFO)
       ↓
ReserveInventory compensate
ProcessPayment compensate
```

### Hybrid Pattern
```
OrderSubmitted Event
       ↓
   Saga State: Submitted → Fulfilling
       ↓
ExecuteFulfillment Command
       ↓
Consumer receives command
       ↓
┌──────────────────────────────────────┐
│     ROUTING SLIP EXECUTION           │
│  PickItems → PackItems →             │
│  GenerateLabel → QualityCheck        │
│  (automatic compensation on failure) │
└──────────────────────────────────────┘
       ↓
FulfillmentCompleted Event
       ↓
   Saga State: Fulfilling → Shipping
       ↓
ArrangeShipping Command → Consumer → ShippingArranged Event
       ↓
   Saga State: Shipping → Completed
```

## Configuration

### Routing Slip Execution Mode

Edit `src/routing-slip.config.ts`:

```typescript
// In-Process Mode (default) - fast, single process
RoutingSlipModeRegistry.setMode(RoutingSlipExecutionMode.InProcess);

// Distributed Mode - via RabbitMQ queues
RoutingSlipModeRegistry.setMode(RoutingSlipExecutionMode.Distributed, 'myapp');
```

## Choosing the Right Pattern

### Use **Saga Pattern** when:
- You need long-running workflows
- State must be persisted across steps
- Workflow spans multiple services
- You want explicit control over each step

### Use **Routing Slip Pattern** when:
- You have multi-step operations
- Steps are related and sequential
- You want automatic compensation
- Operations are relatively short-lived

### Use **Hybrid Pattern** when:
- You have complex workflows with detailed operations
- Some saga steps require multi-step execution
- You want both workflow orchestration AND automatic compensation
- You need clear separation between business logic and operations

## Next Steps

1. **Start with Routing Slips** if you're new - they're simpler
2. **Add Saga** when you need workflow state management
3. **Combine them** when you have complex requirements

## Additional Resources

- [Saga Pattern Documentation](./src/infrastructure/messaging/sagas/)
- [Routing Slips Documentation](./src/infrastructure/messaging/routing-slips/)
- [Hybrid Pattern Guide](./HYBRID_PATTERN_GUIDE.md) - Comprehensive guide
- [Hybrid Pattern README](./src/infrastructure/messaging/hybrid/README.md) - Quick reference

## Support

For issues or questions:
- Check the code comments in example files
- Review the comprehensive logs when running examples
- Refer to the pattern-specific documentation

Happy coding with NestJS BusTransit! 🚀
