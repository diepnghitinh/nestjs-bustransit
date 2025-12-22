# NestJS Service Bus

A powerful NestJS library for building reliable distributed systems with **RabbitMQ**. Simplifies message-based communication with support for the **Saga Pattern**, **Routing Slips**, and comprehensive **Retry Strategies** for managing distributed transactions.

## 📚 Documentation

- **[📖 Complete Documentation Index](./docs/DOCUMENTATION_INDEX.md)** - Find everything in one place
- **[🛠️ Setup Guide](./docs/ROUTING_SLIPS_SETUP.md)** - Installation and configuration details
- **[📘 Routing Slips Guide](./docs/ROUTING_SLIPS.md)** - Activity-based workflow orchestration
- **[📕 Saga Compensation Guide](./docs/COMPENSATION.md)** - Event-driven state machine compensation
- **[⚙️ Retry Strategies](./docs/RETRY_STRATEGIES.md)** - Handle failures gracefully
- **[👨‍💻 Code Examples](./example/src/infrastructure/messaging/)** - Full working examples

## Why Use This Library?

In a microservices architecture, handling transactions that span across multiple services (distributed transactions) is a significant challenge. The Saga Pattern provides an effective solution for maintaining data consistency by orchestrating a sequence of local transactions, with the ability to roll back if any step fails.

This library offers:

* **Easy NestJS Integration:** Leveraging NestJS features like dependency injection, decorators, and modules for seamless Service Bus configuration and usage.
* **Saga Pattern Implementation:** Provides tools and structures to define, execute, and monitor Sagas, ensuring data consistency even when failures occur.
* **Routing Slips Pattern:** Activity-based workflow coordination with automatic compensation for distributed transactions.
* **Comprehensive Retry Strategies:** Four retry strategies (Immediate, Interval, Intervals, Exponential) at two levels (Retry + Redelivery).
* **RabbitMQ Powered:** Utilizes RabbitMQ's performance and reliability as the message transport layer, supporting queuing, routing, and publish/subscribe.
* **Scalability:** Designed to be easily extensible and customizable to meet specific project needs.
* **Robust Error Handling:** Built-in error handling mechanisms help manage failure scenarios and trigger compensation steps within a Saga.

## Getting Started

### Installation
```bash
npm install nestjs-bustransit uuid
# or
yarn add nestjs-bustransit uuid
```

## Roadmap
- [x] RabbitMq Broker
- [x] Retry Level 1 (Immediate, Interval, Intervals, Exponential)
- [x] Retry Level 2 (Redelivery with all strategies)
- [x] Saga pattern
- [x] Saga compensation
- [x] Routing slips pattern
- [ ] Kafka broker

## Core Features

### 🔄 Retry Strategies

Comprehensive retry mechanisms with **4 strategies** (Immediate, Interval, Intervals, Exponential) at **2 levels** (Retry + Redelivery). Handle transient failures gracefully with automatic backoff and requeuing.

**[→ Read the Retry Strategies Guide](./docs/RETRY_STRATEGIES.md)**

### 📨 Consumer & Producer Configuration

Easy setup for message consumers and producers with NestJS dependency injection. Configure endpoints, prefetch counts, and retry policies with a fluent API.

**[→ See Configuration Examples](./example/src/infrastructure/messaging/)**

```typescript
// Configure consumers and retry policies
x.AddConsumer(SubmitOrderConsumer);
x.UsingRabbitMq('my-app', (context, cfg) => {
    cfg.ReceiveEndpoint("orders-queue", e => {
        e.ConfigureConsumer(SubmitOrderConsumer, context, c => {
            c.UseMessageRetry(r => r.Immediate(5));
            c.UseRedelivery(r => r.Exponential(5, 5000, 2));
        });
    });
});
```

### 🎭 Saga Pattern & Compensation

Event-driven state machines with automatic compensation. Build complex workflows that maintain data consistency across distributed services. Define compensating actions that execute in reverse order when failures occur.

**Key Features:**
- State machine orchestration
- Event-driven transitions
- Automatic LIFO compensation
- Long-running process support

**[→ Read the Saga Compensation Guide](./docs/COMPENSATION.md)**
**[→ View Saga Examples](./example/src/infrastructure/messaging/sagas/)**

![Saga Workflow](./docs/saga.png)

### 📋 Routing Slips Pattern

Activity-based workflow orchestration inspired by [MassTransit's Routing Slips](https://masstransit.io/documentation/concepts/routing-slips). Build dynamic, multi-service workflows with reusable activities and automatic compensation.

**Key Features:**
- Reusable activity components
- Dynamic runtime itineraries
- Automatic LIFO compensation
- Rich event system (Completed, Faulted, ActivityCompleted, etc.)
- Variable passing between activities

**[→ Read the Routing Slips Guide](./docs/ROUTING_SLIPS.md)**
**[→ Quick Start Tutorial](./docs/ROUTING_SLIPS_QUICKSTART.md)**
**[→ View Routing Slip Examples](./example/src/infrastructure/messaging/routing-slips/)**

**When to use:**
- **Routing Slips**: Multi-service workflows, dynamic orchestration, reusable activities
- **Saga Compensation**: Complex state machines, long-running processes, event-driven flows

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

This project is licensed under the MIT License.