# Routing Slips Concept and Design

## What is a Routing Slip?

A **Routing Slip** is a design pattern for coordinating distributed transactions across multiple services. Think of it like a physical routing slip you might attach to a document in an office - it contains a list of people who need to review the document, and each person checks off their action when complete.

In software, a routing slip is a message that travels through a series of processing steps (called **activities**), carrying both:
- **An itinerary** - the list of activities to execute
- **Variables** - data passed between activities
- **Execution logs** - history of what's been completed

## The Problem Routing Slips Solve

### Distributed Transaction Challenge

In a microservices architecture, you often need to coordinate work across multiple services:

```
Order Service → Payment Service → Inventory Service → Shipping Service → Email Service
```

Challenges:
- **Partial Failures**: What if payment succeeds but inventory reservation fails?
- **Rollback**: How do you undo completed steps when a later step fails?
- **Coordination**: How do you track progress across services?
- **Coupling**: How do you avoid tightly coupling services together?

### Traditional Approaches and Their Limitations

#### 1. **Two-Phase Commit (2PC)**
```
Coordinator: "Everyone prepare!"
Services: "Ready!" / "Ready!" / "Ready!"
Coordinator: "Everyone commit!"
```
**Problems**:
- Blocking - all services wait for slowest participant
- Single point of failure (coordinator)
- Not suitable for distributed systems with network partitions

#### 2. **Event-Driven Saga (Choreography)**
```
Order Created → Payment Processed → Inventory Reserved → Order Completed
         ↓              ↓                  ↓
    Each service publishes events, others react
```
**Problems**:
- Hard to understand overall flow
- Difficult to add new steps
- Circular dependencies between services

#### 3. **Orchestration Saga (State Machine)**
```
Saga State Machine coordinates all steps
```
**Problems**:
- Tight coupling to saga definition
- Not reusable across different workflows
- Manual compensation logic

### How Routing Slips Solve This

Routing slips provide **orchestration with loose coupling**:

```
Routing Slip Document travels through services
├── Contains: List of activities to execute
├── Carries: Shared variables between activities
├── Tracks: What's been completed
└── Handles: Automatic compensation on failure
```

**Benefits**:
- **Loose Coupling**: Activities don't know about each other
- **Reusability**: Same activity can be used in different workflows
- **Automatic Compensation**: Built into the pattern
- **Dynamic**: Itinerary can change at runtime
- **Observable**: Rich event system for monitoring

## Core Concepts

### 1. Routing Slip (The Document)

The routing slip is a data structure that contains everything needed for execution:

```typescript
{
  trackingNumber: "uuid-123",           // Unique identifier
  createTimestamp: "2024-01-01T00:00Z", // When created

  itinerary: [                          // Activities to execute
    { name: "ProcessPayment", address: "payment-service", arguments: {...} },
    { name: "ReserveInventory", address: "inventory-service", arguments: {...} },
    { name: "ShipOrder", address: "shipping-service", arguments: {...} }
  ],

  variables: {                          // Shared data
    orderId: "order-123",
    customerId: "customer-456",
    paymentIntentId: "pi_789"  // Added by ProcessPayment activity
  },

  activityLogs: [                       // Execution history
    { activityName: "ProcessPayment", timestamp: "...", compensationLog: {...} }
  ],

  activityExceptions: []                // Errors if any
}
```

**Key Properties**:
- **Tracking Number**: Unique ID for the routing slip (like a package tracking number)
- **Itinerary**: Ordered list of activities to execute (like a to-do list)
- **Variables**: Key-value store for data (like a shared clipboard)
- **Activity Logs**: History of completed activities (like a paper trail)

### 2. Activities (The Processing Steps)

An **Activity** is a self-contained unit of work that:
- Receives arguments and variables
- Performs business logic
- Optionally stores compensation data
- Returns a result (Complete/Fault/Terminate)

**Two Types of Activities**:

#### IActivity<TArguments, TLog> - With Compensation
```typescript
class ProcessPaymentActivity implements IActivity<PaymentArgs, PaymentLog> {
    // Execute the activity
    async execute(context: IExecuteContext<PaymentArgs>) {
        // 1. Do the work
        const paymentId = await this.chargeCustomer(context.arguments.amount);

        // 2. Store data for next activities
        const variables = new Map(context.variables);
        variables.set('paymentId', paymentId);

        // 3. Save data needed for compensation
        const compensationLog = {
            paymentId,
            amount: context.arguments.amount,
            timestamp: new Date()
        };

        // 4. Return success
        return context.completedWithVariables(variables, compensationLog);
    }

    // Undo the activity if a later step fails
    async compensate(context: ICompensateContext<PaymentLog>) {
        await this.refundCustomer(
            context.compensationLog.paymentId,
            context.compensationLog.amount
        );
    }
}
```

#### IExecuteActivity<TArguments> - Execute Only
```typescript
class SendEmailActivity implements IExecuteActivity<EmailArgs> {
    // Execute the activity
    async execute(context: IExecuteContext<EmailArgs>) {
        await this.sendEmail(context.arguments.email, context.arguments.body);
        return context.completed(); // No compensation - can't "unsend" email
    }
}
```

### 3. Itinerary (The Route)

The **itinerary** is the ordered list of activities to execute:

```typescript
[
  { name: "ValidateOrder", address: "validation-service", arguments: {...} },
  { name: "ProcessPayment", address: "payment-service", arguments: {...} },
  { name: "ReserveInventory", address: "inventory-service", arguments: {...} },
  { name: "CreateShipment", address: "shipping-service", arguments: {...} },
  { name: "SendConfirmation", address: "email-service", arguments: {...} }
]
```

**Properties**:
- **Ordered**: Activities execute in sequence
- **Dynamic**: Can be modified at runtime (itinerary revision)
- **Conditional**: Can be built based on conditions

### 4. Variables (Shared Data)

**Variables** are a key-value store that passes data between activities:

```typescript
// Initial variables
variables = {
  orderId: "order-123",
  amount: 99.99,
  customerId: "customer-456"
}

// After ProcessPayment activity
variables = {
  orderId: "order-123",
  amount: 99.99,
  customerId: "customer-456",
  paymentIntentId: "pi_789"  // ← Added by ProcessPayment
}

// After ReserveInventory activity
variables = {
  orderId: "order-123",
  amount: 99.99,
  customerId: "customer-456",
  paymentIntentId: "pi_789",
  reservationId: "res_abc"    // ← Added by ReserveInventory
}
```

**Usage**:
- Activities **read** from variables (access data from previous activities)
- Activities **write** to variables (pass data to next activities)
- Variables are **immutable** between activities (new map created on each update)

### 5. Compensation (The Rollback)

**Compensation** is the process of undoing completed activities when a failure occurs.

**Key Principles**:
1. **Reverse Order (LIFO)**: Last activity compensates first
2. **Automatic**: Triggered automatically on activity fault
3. **Log-Based**: Uses compensation logs stored during execution
4. **Independent**: Each compensation is independent

**Compensation Flow**:
```
Execution:  Activity A → Activity B → Activity C → FAULT!
              ✓ (log₁)    ✓ (log₂)    ✓ (log₃)    ✗

Compensation: Activity C ← Activity B ← Activity A
              (use log₃)  (use log₂)  (use log₁)
                ✓           ✓           ✓
```

### 6. Activity Results

Activities return one of three result types:

#### Complete
```typescript
return context.completed(compensationLog);
```
- Activity succeeded
- Continue to next activity in itinerary
- Compensation log saved for potential rollback

#### Fault
```typescript
return context.faulted(new Error("Payment declined"));
```
- Activity failed
- Stop execution
- Trigger compensation of all previous activities

#### Terminate
```typescript
return context.terminated();
```
- Stop execution gracefully
- No compensation (not an error)
- Used for conditional early exit

### 7. Event System

The routing slip executor publishes events for monitoring:

```typescript
// Routing slip level events
- RoutingSlipCompleted      // All activities completed
- RoutingSlipFaulted        // Activity faulted, compensation triggered
- RoutingSlipTerminated     // Gracefully terminated
- RoutingSlipCompensationFailed  // Compensation itself failed

// Activity level events
- RoutingSlipActivityCompleted    // Individual activity completed
- RoutingSlipActivityFaulted      // Individual activity faulted
- RoutingSlipActivityCompensated  // Individual activity compensated
```

## How It Works: End-to-End Example

### Scenario: Order Processing

```
Customer places order for $99.99
├── Step 1: Process payment
├── Step 2: Reserve inventory
├── Step 3: Create shipment
└── Step 4: Send confirmation email
```

### 1. Build the Routing Slip

```typescript
const routingSlip = RoutingSlipBuilder.create('order-123')
    .addActivity('ProcessPayment', 'payment-service', {
        orderId: 'order-123',
        amount: 99.99,
        customerId: 'customer-456'
    })
    .addActivity('ReserveInventory', 'inventory-service', {
        orderId: 'order-123',
        items: [{ sku: 'ITEM-001', quantity: 2 }]
    })
    .addActivity('CreateShipment', 'shipping-service', {
        orderId: 'order-123'
    })
    .addActivity('SendConfirmation', 'email-service', {
        orderId: 'order-123',
        email: 'customer@example.com'
    })
    .addVariable('orderId', 'order-123')
    .addVariable('customerEmail', 'customer@example.com')
    .build();
```

**Result**:
```typescript
{
  trackingNumber: "order-123",
  itinerary: [
    { name: "ProcessPayment", ... },
    { name: "ReserveInventory", ... },
    { name: "CreateShipment", ... },
    { name: "SendConfirmation", ... }
  ],
  variables: { orderId: "order-123", customerEmail: "..." },
  activityLogs: [],
  activityExceptions: []
}
```

### 2. Execute the Routing Slip (Success Path)

#### Step 1: ProcessPayment Activity

```typescript
// Executor calls activity
const context = new ExecuteContext(
    trackingNumber: "order-123",
    arguments: { orderId: "order-123", amount: 99.99, ... },
    variables: Map { orderId: "order-123", customerEmail: "..." }
);

const result = await processPaymentActivity.execute(context);

// Activity executes
- Charge customer $99.99
- Get payment intent ID: "pi_789"
- Return: completedWithVariables(
    variables: Map { ..., paymentIntentId: "pi_789" },
    compensationLog: { paymentIntentId: "pi_789", amount: 99.99 }
  )

// Executor handles result
- Add to activityLogs: { activityName: "ProcessPayment", compensationLog: {...} }
- Merge variables: { orderId: "...", customerEmail: "...", paymentIntentId: "pi_789" }
- Emit: RoutingSlipActivityCompleted event
- Continue to next activity
```

**Routing Slip State**:
```typescript
{
  trackingNumber: "order-123",
  itinerary: [...], // 3 activities remaining
  variables: {
    orderId: "order-123",
    customerEmail: "...",
    paymentIntentId: "pi_789"  // ← Added
  },
  activityLogs: [
    { activityName: "ProcessPayment", timestamp: "...", compensationLog: {...} }
  ]
}
```

#### Step 2: ReserveInventory Activity

```typescript
// Executor calls activity
const context = new ExecuteContext(
    trackingNumber: "order-123",
    arguments: { orderId: "order-123", items: [...] },
    variables: Map {
        orderId: "order-123",
        customerEmail: "...",
        paymentIntentId: "pi_789"  // ← Available from previous activity
    }
);

const result = await reserveInventoryActivity.execute(context);

// Activity executes
- Reserve 2 units of ITEM-001
- Get reservation ID: "res_abc"
- Return: completedWithVariables(
    variables: Map { ..., reservationId: "res_abc" },
    compensationLog: { reservationId: "res_abc", items: [...] }
  )

// Executor handles result
- Add to activityLogs
- Merge variables: { ..., reservationId: "res_abc" }
- Emit: RoutingSlipActivityCompleted event
- Continue to next activity
```

#### Step 3: CreateShipment Activity

```typescript
// Similar process...
- Create shipment
- Return: completedWithVariables(
    variables: Map { ..., shipmentId: "ship_xyz" },
    compensationLog: { shipmentId: "ship_xyz" }
  )
```

#### Step 4: SendConfirmation Activity

```typescript
// Execute-only activity (no compensation)
const result = await sendConfirmationActivity.execute(context);

// Activity executes
- Access all variables: paymentIntentId, reservationId, shipmentId
- Send confirmation email
- Return: completed() // No compensation log

// Executor handles result
- Add to activityLogs (no compensation log)
- No more activities in itinerary
- Emit: RoutingSlipCompleted event
```

**Final Routing Slip State**:
```typescript
{
  trackingNumber: "order-123",
  itinerary: [], // All completed
  variables: {
    orderId: "order-123",
    customerEmail: "...",
    paymentIntentId: "pi_789",
    reservationId: "res_abc",
    shipmentId: "ship_xyz"
  },
  activityLogs: [
    { activityName: "ProcessPayment", ... },
    { activityName: "ReserveInventory", ... },
    { activityName: "CreateShipment", ... },
    { activityName: "SendConfirmation", ... }
  ],
  activityExceptions: [] // No errors
}
```

### 3. Execute the Routing Slip (Failure Path)

Now let's see what happens when inventory reservation fails:

#### Step 1: ProcessPayment - Success ✓

```typescript
- Charge $99.99 → paymentIntentId: "pi_789"
- Activity logs: [{ activityName: "ProcessPayment", compensationLog: {...} }]
```

#### Step 2: ReserveInventory - FAULT ✗

```typescript
// Activity executes
try {
    await this.inventoryService.reserve(items);
} catch (error) {
    // Out of stock!
    return context.faulted(new Error("Item ITEM-001 out of stock"));
}

// Executor receives FAULT result
- Add to activityExceptions: {
    activityName: "ReserveInventory",
    exceptionInfo: { message: "Item ITEM-001 out of stock", ... }
  }
- Emit: RoutingSlipActivityFaulted event
- STOP execution (don't continue to next activities)
- START compensation
```

#### Compensation Phase

```typescript
// Executor reverses activity logs (LIFO)
activityLogs.reverse() // [ ProcessPayment ]

// Compensate each activity in reverse order
for (const log of reversedLogs) {
    const activity = getActivity(log.activityName);

    if (activity has compensate method) {
        const compensateContext = new CompensateContext(
            trackingNumber: "order-123",
            compensationLog: log.compensationLog,
            variables: routingSlip.variables
        );

        await activity.compensate(compensateContext);

        // Log compensation
        compensateLogs.push({ activityName: log.activityName, ... });

        // Emit: RoutingSlipActivityCompensated event
    }
}

// Compensation: ProcessPayment
await processPaymentActivity.compensate({
    trackingNumber: "order-123",
    compensationLog: { paymentIntentId: "pi_789", amount: 99.99 },
    variables: Map {...}
});
// → Refund $99.99 to customer
// → Compensation successful ✓

// Emit: RoutingSlipFaulted event
```

**Final Routing Slip State**:
```typescript
{
  trackingNumber: "order-123",
  activityLogs: [
    { activityName: "ProcessPayment", ... }  // Completed but then compensated
  ],
  compensateLogs: [
    { activityName: "ProcessPayment", ... }  // Compensation executed
  ],
  activityExceptions: [
    { activityName: "ReserveInventory", exceptionInfo: {...} }  // The failure
  ],
  variables: { ... }
}
```

## Visual Representation

### Success Flow

```
┌─────────────────────────────────────────────────────────────────┐
│ Routing Slip: order-123                                         │
│ Itinerary: [ProcessPayment, ReserveInventory, SendConfirmation]│
│ Variables: { orderId: "order-123" }                            │
└─────────────────────────────────────────────────────────────────┘
                           │
                           ▼
        ┌──────────────────────────────────────┐
        │ Activity 1: ProcessPayment           │
        │ Execute: Charge $99.99               │
        │ Result: Complete ✓                   │
        │ Stores: paymentIntentId = "pi_789"   │
        │ Compensation Log: {paymentIntentId}  │
        └──────────────────────────────────────┘
                           │
                           ▼
        ┌──────────────────────────────────────┐
        │ Activity 2: ReserveInventory         │
        │ Execute: Reserve 2 units             │
        │ Result: Complete ✓                   │
        │ Stores: reservationId = "res_abc"    │
        │ Compensation Log: {reservationId}    │
        └──────────────────────────────────────┘
                           │
                           ▼
        ┌──────────────────────────────────────┐
        │ Activity 3: SendConfirmation         │
        │ Execute: Send email                  │
        │ Result: Complete ✓                   │
        │ No Compensation (can't unsend email) │
        └──────────────────────────────────────┘
                           │
                           ▼
              ┌────────────────────────┐
              │ Routing Slip Completed │
              │ All activities ✓       │
              └────────────────────────┘
```

### Failure Flow with Compensation

```
┌─────────────────────────────────────────────────────────────────┐
│ Routing Slip: order-123                                         │
│ Itinerary: [ProcessPayment, ReserveInventory, SendConfirmation]│
└─────────────────────────────────────────────────────────────────┘
                           │
                           ▼
        ┌──────────────────────────────────────┐
        │ Activity 1: ProcessPayment           │
        │ Execute: Charge $99.99 ✓             │
        │ Compensation Log Stored              │
        └──────────────────────────────────────┘
                           │
                           ▼
        ┌──────────────────────────────────────┐
        │ Activity 2: ReserveInventory         │
        │ Execute: Reserve inventory           │
        │ Result: FAULT ✗                      │
        │ Error: "Out of stock"                │
        └──────────────────────────────────────┘
                           │
                           ▼
              ┌────────────────────────┐
              │ COMPENSATION TRIGGERED │
              │ (Reverse Order - LIFO) │
              └────────────────────────┘
                           │
                           ▼
        ┌──────────────────────────────────────┐
        │ Compensate: ProcessPayment           │
        │ Action: Refund $99.99 ✓              │
        │ Uses: Compensation Log               │
        └──────────────────────────────────────┘
                           │
                           ▼
              ┌────────────────────────┐
              │ Routing Slip Faulted   │
              │ All compensations ✓    │
              └────────────────────────┘
```

## Key Design Patterns

### 1. Command Pattern
Each activity is a command with execute and (optionally) undo operations.

### 2. Memento Pattern
Compensation logs act as mementos, storing state needed to undo operations.

### 3. Chain of Responsibility
Activities process the routing slip in sequence, each handling one concern.

### 4. Observer Pattern
Event system allows observers to react to routing slip events.

### 5. Builder Pattern
Fluent API for constructing routing slips.

## Comparison with Other Patterns

### Routing Slips vs Saga Pattern (Choreography)

**Saga (Choreography)**:
```
Service A publishes Event₁
    → Service B subscribes, processes, publishes Event₂
        → Service C subscribes, processes, publishes Event₃
```

**Routing Slips**:
```
Routing Slip contains [Activity A, Activity B, Activity C]
Executor runs: A → B → C
```

| Aspect | Routing Slips | Saga Choreography |
|--------|--------------|-------------------|
| Coordination | Centralized (executor) | Distributed (events) |
| Visibility | Full workflow visible | Workflow implicit |
| Changes | Easy to modify | Hard to modify |
| Debugging | Easy to trace | Difficult to trace |
| Reusability | High | Low |

### Routing Slips vs Saga Pattern (Orchestration)

**Saga (Orchestration)**:
```
Saga State Machine
├── State 1 → Event → Service A
├── State 2 → Event → Service B
└── State 3 → Event → Service C
```

**Routing Slips**:
```
Routing Slip
├── Activity A
├── Activity B
└── Activity C
```

| Aspect | Routing Slips | Saga Orchestration |
|--------|--------------|-------------------|
| Coupling | Loose (activities) | Tight (saga definition) |
| State | Routing slip document | Persisted saga state |
| Reusability | High | Medium |
| Complexity | Lower | Higher |
| Best For | Multi-service workflows | Complex business processes |

## When to Use Routing Slips

### ✅ Use Routing Slips When:

1. **Multi-Service Coordination**
   - Workflow spans multiple independent services
   - Services don't need to know about each other

2. **Reusable Activities**
   - Same activities used in different workflows
   - Activities are self-contained units

3. **Dynamic Workflows**
   - Workflow changes based on runtime conditions
   - Need to add/remove steps dynamically

4. **Clear Compensation**
   - Each step has a clear undo operation
   - Compensation is independent per step

5. **Short-Lived Workflows**
   - Workflow completes in reasonable time
   - Don't need persistent state between steps

### ❌ Don't Use Routing Slips When:

1. **Complex State Management**
   - Need to persist state between steps
   - Long-running processes (days/weeks)
   - → Use Saga State Machine instead

2. **Simple Linear Flows**
   - Just a few sequential API calls
   - No compensation needed
   - → Use simple service orchestration

3. **Event-Driven Architecture**
   - Services are already event-driven
   - Prefer reactive flows
   - → Use event choreography

4. **No Compensation Possible**
   - Steps can't be undone
   - No rollback strategy
   - → Consider different pattern

## Best Practices

### Activity Design

```typescript
// ✅ Good: Single responsibility, idempotent
class ProcessPaymentActivity {
    async execute(context) {
        // 1. Validate
        if (context.arguments.amount <= 0) {
            return context.faulted(new Error("Invalid amount"));
        }

        // 2. Check idempotency
        if (context.variables.has('paymentIntentId')) {
            return context.completed(); // Already processed
        }

        // 3. Execute
        const paymentId = await this.payment.charge(context.arguments);

        // 4. Store result
        return context.completedWithVariables(
            new Map([['paymentIntentId', paymentId]]),
            { paymentId, amount: context.arguments.amount }
        );
    }
}

// ❌ Bad: Multiple responsibilities, not idempotent
class ProcessOrderActivity {
    async execute(context) {
        await this.payment.charge();
        await this.inventory.reserve();
        await this.shipping.create();
        // Too much in one activity!
    }
}
```

### Compensation Design

```typescript
// ✅ Good: Idempotent, defensive
async compensate(context) {
    // 1. Check if already compensated
    if (await this.isAlreadyRefunded(context.compensationLog.paymentId)) {
        Logger.log("Already refunded, skipping");
        return;
    }

    // 2. Execute compensation
    try {
        await this.payment.refund(context.compensationLog.paymentId);
    } catch (error) {
        if (error.code === 'ALREADY_REFUNDED') {
            // Idempotent - this is OK
            return;
        }
        throw error; // Real error
    }
}

// ❌ Bad: Not idempotent, no error handling
async compensate(context) {
    await this.payment.refund(context.compensationLog.paymentId);
    // What if called twice? What if fails?
}
```

### Variable Usage

```typescript
// ✅ Good: Explicit, typed
interface OrderVariables {
    orderId: string;
    paymentIntentId?: string;
    reservationId?: string;
}

async execute(context: IExecuteContext<Args>) {
    const paymentId = context.variables.get('paymentIntentId') as string;
    if (!paymentId) {
        return context.faulted(new Error("Payment ID required"));
    }
    // Use paymentId...
}

// ❌ Bad: Implicit, untyped
async execute(context) {
    const paymentId = context.variables.get('pid'); // What is 'pid'?
    // Use paymentId...
}
```

## Conclusion

Routing slips provide a powerful pattern for coordinating distributed transactions:

- **Loose Coupling**: Activities are independent and reusable
- **Automatic Compensation**: Built-in rollback on failure
- **Observable**: Rich events for monitoring
- **Flexible**: Dynamic workflows, conditional logic
- **Type-Safe**: Full TypeScript support

Use routing slips when you need to orchestrate multi-service workflows with clear compensation logic, and use saga state machines when you need complex state management and long-running processes.

Both patterns are now available in this library - choose the right tool for your use case!
