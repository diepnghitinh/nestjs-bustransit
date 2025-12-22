# NestJS BusTransit Documentation Index

Complete documentation for the NestJS BusTransit library - a powerful service bus implementation with saga patterns, compensation, and routing slips.

## 📚 Table of Contents

### Getting Started
- [Main README](./README.md) - Overview, installation, and quick start
- [Quick Start Guide](#quick-start-below) - Get up and running in 5 minutes
- [Setup Guide](./ROUTING_SLIPS_SETUP.md) - Installation and configuration details

### Patterns and Features

#### Retry Strategies
- **[Retry Strategies Guide](./RETRY_STRATEGIES.md)** - Comprehensive retry mechanisms
  - Level 1 (Retry): Immediate, Interval, Intervals, Exponential
  - Level 2 (Redelivery): Message requeue with delays
  - When to use each strategy
  - Configuration examples

#### Saga Pattern
- **[Saga Compensation Pattern](./COMPENSATION.md)** - Event-driven compensation
  - State machine based workflows
  - Manual compensation trigger
  - Best for long-running business processes
  - Complex state management
  - Event-driven architectures

#### Routing Slips Pattern
- **[Routing Slips Overview](./ROUTING_SLIPS.md)** - Activity-based orchestration ⭐
  - Quick reference and API documentation
  - Core components (Activities, Builder, Executor)
  - Complete usage examples
  - Best practices and troubleshooting

- **[Routing Slips Concepts](./ROUTING_SLIPS_CONCEPTS.md)** - Deep dive into the pattern
  - What is a routing slip? Why use it?
  - Core concepts explained in detail
  - Visual execution flow diagrams
  - End-to-end examples (success and failure scenarios)
  - Design patterns and architecture


### Technical Documentation
- **[Routing Slips Implementation Summary](./ROUTING_SLIPS_IMPLEMENTATION_SUMMARY.md)** - Technical details
  - Files created and modified
  - Architecture decisions
  - API reference
  - Dependencies and technical notes

## 🚀 Quick Start

### Installation

```bash
npm install nestjs-bustransit
# or
yarn add nestjs-bustransit
```

### Basic Consumer Setup

```typescript
import { BusTransit } from 'nestjs-bustransit';

@Module({
  imports: [
    BusTransit.AddBusTransit.Setup((x) => {
      x.AddConsumer(OrderConsumer);

      x.UsingRabbitMq('my-app', (context, cfg) => {
        cfg.Host('localhost', '/', (h) => {
          h.Username('guest');
          h.Password('guest');
        });

        cfg.ReceiveEndpoint("orders-queue", e => {
          e.ConfigureConsumer(OrderConsumer, context, c => {
            c.UseMessageRetry(r => r.Immediate(3));
            c.UseRedelivery(r => r.Exponential(5, 5000, 2));
          });
        });
      });
    })
  ]
})
export class AppModule {}
```

### Using Saga Compensation

```typescript
@Injectable()
export class OrderStateMachine extends BusTransitStateMachine<OrderState> {
  constructor() {
    super(OrderState);

    this.When(PaymentProcessed)
      .Then(c => {
        c.Saga.PaymentId = c.Message.PaymentId;
      })
      .PublishAsync(ReserveInventory, c => new ReserveInventory())
      .Compensate(async c => {
        // Refund payment if inventory reservation fails
        await refundPayment(c.Saga.PaymentId);
      })
      .TransitionTo(this.ReservingInventory);
  }
}
```

### Using Routing Slips

```typescript
// 1. Define an activity
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

// 2. Build and execute routing slip
const routingSlip = RoutingSlipBuilder.create('order-123')
  .addActivity('ProcessPayment', 'payment', { amount: 99.99 })
  .addActivity('ReserveInventory', 'inventory', { items: [...] })
  .addActivity('SendConfirmation', 'email', { email: 'user@example.com' })
  .build();

const executor = new RoutingSlipExecutor(activityFactory);
await executor.execute(routingSlip);
```

## 📖 Documentation by Topic

### Distributed Transactions

| Topic | Document | Best For |
|-------|----------|----------|
| **Saga Compensation** | [COMPENSATION.md](./COMPENSATION.md) | Long-running processes, event-driven flows, complex state machines |
| **Routing Slips** | [ROUTING_SLIPS.md](./ROUTING_SLIPS.md) | Multi-service workflows, reusable activities, dynamic orchestration |

### Resilience and Reliability

| Topic | Document | Best For |
|-------|----------|----------|
| **Retry Strategies** | [RETRY_STRATEGIES.md](./RETRY_STRATEGIES.md) | Handling transient failures, exponential backoff |
| **Immediate Retry** | [RETRY_STRATEGIES.md#immediate](./RETRY_STRATEGIES.md) | Fast, transient failures |
| **Exponential Backoff** | [RETRY_STRATEGIES.md#exponential](./RETRY_STRATEGIES.md) | Rate limiting, overload protection |

### Architecture and Concepts

| Topic | Document | Description |
|-------|----------|-------------|
| **Routing Slips Concepts** | [ROUTING_SLIPS_CONCEPTS.md](./ROUTING_SLIPS_CONCEPTS.md) | Deep dive into pattern design |
| **Implementation Details** | [ROUTING_SLIPS_IMPLEMENTATION_SUMMARY.md](./ROUTING_SLIPS_IMPLEMENTATION_SUMMARY.md) | Technical architecture |

## 🔍 Find What You Need

### I want to...

#### Handle Failures and Retry
- **Retry failed messages** → [Retry Strategies](./RETRY_STRATEGIES.md)
- **Undo completed steps** → [Saga Compensation](./COMPENSATION.md) or [Routing Slips](./ROUTING_SLIPS.md)
- **Handle transient errors** → [Retry Strategies - Immediate](./RETRY_STRATEGIES.md#immediate)
- **Prevent overload** → [Retry Strategies - Exponential](./RETRY_STRATEGIES.md#exponential)

#### Coordinate Distributed Workflows
- **Simple multi-service workflow** → [Routing Slips](./ROUTING_SLIPS.md)
- **Complex business process** → [Saga Compensation](./COMPENSATION.md)
- **Reusable workflow components** → [Routing Slips](./ROUTING_SLIPS.md)
- **Event-driven coordination** → [Saga Compensation](./COMPENSATION.md)

#### Learn Patterns
- **What is a routing slip?** → [Routing Slips Concepts](./ROUTING_SLIPS_CONCEPTS.md)
- **Best practices** → [Routing Slips - Best Practices](./ROUTING_SLIPS.md#best-practices)
- **Design patterns** → [Routing Slips Concepts - Design Patterns](./ROUTING_SLIPS_CONCEPTS.md#key-design-patterns)

#### Examples and Code
- **Saga example** → [COMPENSATION.md - Usage Example](./COMPENSATION.md#usage-example)
- **Routing slip example** → [ROUTING_SLIPS.md - Complete Example](./ROUTING_SLIPS.md#complete-example)
- **Activity examples** → [Implementation Summary](./ROUTING_SLIPS_IMPLEMENTATION_SUMMARY.md#example-implementation)
- **Retry configuration** → [Retry Strategies - Examples](./RETRY_STRATEGIES.md#examples)

## 🎯 Common Use Cases

### E-commerce Order Processing

**Use Case**: Process payment → Reserve inventory → Create shipment → Send confirmation

**Recommended Pattern**: [Routing Slips](./ROUTING_SLIPS.md)

**Why**: Short-lived workflow, clear compensation, multi-service coordination

**See**: [Routing Slips - Complete Example](./ROUTING_SLIPS.md#complete-example)

---

### Loan Application Processing

**Use Case**: Submit application → Credit check → Manual approval → Funds transfer

**Recommended Pattern**: [Saga Compensation](./COMPENSATION.md)

**Why**: Long-running process, complex state, may pause for approval

**See**: [Saga Compensation - Usage Example](./COMPENSATION.md#usage-example)

---

### Data Transformation Pipeline

**Use Case**: Extract data → Transform → Validate → Load → Notify

**Recommended Pattern**: [Routing Slips](./ROUTING_SLIPS.md)

**Why**: Sequential steps, reusable activities, dynamic composition

**See**: [Routing Slips Concepts - Use Cases](./ROUTING_SLIPS_CONCEPTS.md#when-to-use-routing-slips)

---

### API Integration Workflow

**Use Case**: Call API 1 → Transform response → Call API 2 → Store result

**Recommended Pattern**: [Routing Slips](./ROUTING_SLIPS.md)

**Why**: Multi-service orchestration, clear error handling

**See**: [Routing Slips - Advanced Patterns](./ROUTING_SLIPS.md#advanced-patterns)

---

### Insurance Claim Processing

**Use Case**: Submit claim → Validate → Investigate → Approve/Reject → Payout

**Recommended Pattern**: [Saga Compensation](./COMPENSATION.md)

**Why**: Complex business logic, long-running, state-dependent decisions


## 🌟 Feature Matrix

| Feature | Saga Compensation | Routing Slips |
|---------|------------------|---------------|
| **Automatic Compensation** | Manual trigger | ✅ Automatic on fault |
| **Reusable Components** | ❌ Tied to saga | ✅ Reusable activities |
| **State Persistence** | ✅ Yes | ❌ No (short-lived) |
| **Dynamic Workflows** | ❌ Fixed state machine | ✅ Runtime composition |
| **Event-Driven** | ✅ Yes | ❌ No |
| **Long-Running** | ✅ Yes (persistent) | ❌ No (completes quickly) |
| **Complexity** | Higher | Lower |
| **Learning Curve** | Steeper | Gentler |

## 📝 Contributing

- Report issues on [GitHub](https://github.com/diepnghitinh/nestjs-bustransit/issues)
- Read the implementation summaries before contributing
- Follow existing patterns and conventions

## 🔗 External Resources

- [MassTransit Documentation](https://masstransit.io) - Original inspiration
- [MassTransit Routing Slips](https://masstransit.io/documentation/concepts/routing-slips) - Routing slips pattern
- [Saga Pattern](https://microservices.io/patterns/data/saga.html) - General saga information
- [Microservices Patterns](https://microservices.io/patterns/index.html) - Related patterns

## 📄 License

See the main [README](./README.md) for license information.

