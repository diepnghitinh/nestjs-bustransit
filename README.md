# NestJS Service Bus

A powerful NestJS library for building reliable distributed systems with **RabbitMQ**. Simplifies message-based communication with support for the **Saga Pattern**, **Routing Slips**, and comprehensive **Retry Strategies** for managing distributed transactions.

## 📚 Documentation

- **[📖 Complete Documentation Index](./docs/DOCUMENTATION_INDEX.md)** - Find everything in one place
- **[🛠️ Setup Guide](./docs/ROUTING_SLIPS_SETUP.md)** - Installation and configuration details
- **[📘 Routing Slips Guide](./docs/ROUTING_SLIPS.md)** - Activity-based workflow orchestration
- **[📕 Saga Compensation Guide](./docs/COMPENSATION.md)** - Event-driven state machine compensation
- **[💾 Saga Persistence Guide](./docs/SAGA_PERSISTENCE.md)** - Production-ready state persistence
- **[⚙️ Retry Strategies](./docs/RETRY_STRATEGIES.md)** - Handle failures gracefully
- **[👨‍💻 Code Examples](./example/src/infrastructure/messaging/)** - Full working examples

## Why Use This Library?

In a microservices architecture, handling transactions that span across multiple services (distributed transactions) is a significant challenge. The Saga Pattern provides an effective solution for maintaining data consistency by orchestrating a sequence of local transactions, with the ability to roll back if any step fails.

This library offers:

* **Easy NestJS Integration:** Leveraging NestJS features like dependency injection, decorators, and modules for seamless Service Bus configuration and usage.
* **Saga Pattern Implementation:** Provides tools and structures to define, execute, and monitor Sagas, ensuring data consistency even when failures occur.
* **Production-Ready Saga Persistence:** Database-backed state management with support for MongoDB, PostgreSQL, and in-memory storage, including optimistic locking and auto-archiving.
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

## Reliability

- **Await every publish.** `Publish` resolves once RabbitMQ confirms the message and rejects when the broker refuses it or does not confirm within `publishTimeoutMs`. When the broker refuses a publish it closes the channel, so other publishes in flight on that channel at that moment also reject; retry them. A publish made while the connection is down first waits up to `readyTimeoutMs` for it, then up to `publishTimeoutMs` for the confirm. A rejected publish may still have reached the broker (for example when the connection dropped before the confirm arrived), so retrying it can deliver the message twice.
- **Order is kept only between awaited publishes.** Publishes that run at the same time (for example in `Promise.all`) can reach the broker in a different order than they were called, because the first publish to an exchange checks that it exists first. When order matters, await each `Publish` before the next.
- **Publishers make sure their exchange exists.** An existing exchange is used as it is. A missing one is created (fanout, durable), so publishing a message type before its consumer is deployed does not break other publishes. The message itself is dropped and logged as `Unroutable message`; `Publish` still resolves.
- **Failures stay local.** A channel the broker closes is reopened on next use. Each consumer restarts on its own. A lost connection reconnects every `reconnectDelayMs`.
- **At-least-once delivery.** A message in progress when its channel dies is delivered again. Make consumers idempotent.
- **Deleted topology comes back.** A consuming process declares its exchanges and bindings again every `topologyRefreshMs` (60 s by default), on its own short-lived channels. An exchange that exists is used as it is, whatever its settings; only a missing one is created. If an operator deletes an exchange or a binding, until the next refresh: the first publish to a deleted exchange (and any publish in flight on the same channel) may reject with the broker's 404, later ones resolve but are unroutable and dropped (logged as `Unroutable message`), and delayed messages that come due are lost if the delay exchange or its binding is gone. Do not delete exchanges or bindings of a running system. The refresh cannot be disabled; `topologyRefreshMs` accepts at most 2147483647 (about 24.8 days), and every other `reliability` value has the same maximum.
- **Failed messages.** After its in-place retries, a failed message goes to delayed redelivery or to `<queue>_error`. While the bus is shutting down it goes back to its queue instead, after `requeueDelayMs` and within the drain, because the failure is usually the shutdown itself (for example a `Send` whose target consumer already stopped); it is delivered again after the restart.
- **Shutdown.** Call `app.enableShutdownHooks()`. Shutdown stops consuming, waits up to `shutdownTimeoutMs` for messages in progress, in `beforeApplicationShutdown`, and closes the connection in `onApplicationShutdown`, so publishing keeps working while the app shuts down. Release your own resources (database connections) in `onApplicationShutdown`; by then the bus has stopped taking messages. Handlers still running after `shutdownTimeoutMs` may fail when those resources go away; their messages go back to the queue and are delivered again. The drain runs once, so shutdown takes at most `shutdownTimeoutMs` plus about 2 s to close the connection, even when the broker has stopped answering. If the broker cannot be reached when shutdown starts, closing waits at most 2 s for a connection attempt still in progress; each attempt gives up after `readyTimeoutMs`. Keep `shutdownTimeoutMs` below your container's stop grace period. A message that fails during the drain is handed back to its queue after `requeueDelayMs` (still within the drain), not parked. `BusTransitService.stopConsuming()` is final: the bus never consumes again after it, so call it only to shut down.

```ts
x.UsingRabbitMq(configService.get('APP_NAME'), (context, cfg) => {
    cfg.UseReliability({ shutdownTimeoutMs: 35000 }); // ESB containers get 40 s to stop
    // ...
});
```

Health check:

```ts
@Get('health/bus')
health() {
    const health = this.busTransitService.getHealth();
    if (!health.connected) throw new ServiceUnavailableException(health);
    return health;
}
```

## Roadmap
- [x] RabbitMq Broker
- [x] Retry Level 1 (Immediate, Interval, Intervals, Exponential)
- [x] Retry Level 2 (Redelivery with all strategies)
- [x] Saga pattern
- [x] Saga compensation
- [x] Saga state persistence (MongoDB, PostgreSQL, In-Memory)
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

### 💾 Saga State Persistence

Production-ready state management for saga state machines with database persistence. Persist saga state across application restarts with support for multiple storage backends.

**Key Features:**
- Multiple storage adapters (InMemory, MongoDB, PostgreSQL)
- Optimistic locking for concurrent updates
- Auto-archiving with configurable TTL
- Retry logic with exponential backoff
- Backward compatible (defaults to in-memory)
- Async configuration support

**[→ Read the Saga Persistence Guide](./docs/SAGA_PERSISTENCE.md)**
**[→ Configuration Guide](./docs/SAGA_PERSISTENCE_CONFIGURATION.md)**
**[→ Migration Guide](./docs/SAGA_PERSISTENCE_MIGRATION.md)**

```typescript
// Configure persistence for production
@Module({
  imports: [
    SagaPersistenceModule.forRoot({
      type: SagaPersistenceType.MongoDB,
      connection: {
        uri: 'mongodb://localhost:27017',
        database: 'bustransit',
        collectionName: 'saga_states'
      },
      autoArchive: true,
      archiveTTL: 86400 * 30 // 30 days
    }),
    BusTransit.AddBusTransit.setUp(bus => {
      bus.AddSagaStateMachine(OrderStateMachine, OrderState);
    })
  ]
})
export class AppModule {}
```

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

Run `npm run typecheck` and `npm test`. The integration tests (`npm run test:integration`) need a RabbitMQ broker in `RABBITMQ_URL` and its management API in `RABBITMQ_MANAGEMENT_URL`; they are skipped without one. The delayed-redelivery tests need a second broker with the [delayed-message plugin](https://github.com/rabbitmq/rabbitmq-delayed-message-exchange) in `RABBITMQ_DELAYED_URL` and `RABBITMQ_DELAYED_MANAGEMENT_URL`, for example:

```bash
curl -fsSLO https://github.com/rabbitmq/rabbitmq-delayed-message-exchange/releases/download/v3.13.0/rabbitmq_delayed_message_exchange-3.13.0.ez
echo '[rabbitmq_management,rabbitmq_delayed_message_exchange].' > enabled_plugins
docker run -d --name bt-delayed -p 5673:5672 -p 15673:15672 \
  -e RABBITMQ_DEFAULT_USER=bustransit -e RABBITMQ_DEFAULT_PASS=bustransit \
  -v "${PWD}/rabbitmq_delayed_message_exchange-3.13.0.ez:/opt/rabbitmq/plugins/rabbitmq_delayed_message_exchange-3.13.0.ez:ro" \
  -v "${PWD}/enabled_plugins:/etc/rabbitmq/enabled_plugins:ro" \
  rabbitmq:3.13-management
until curl -sf -u bustransit:bustransit http://localhost:15673/api/overview > /dev/null; do sleep 2; done
RABBITMQ_DELAYED_URL=amqp://bustransit:bustransit@localhost:5673 \
RABBITMQ_DELAYED_MANAGEMENT_URL=http://bustransit:bustransit@localhost:15673 \
npm run test:integration
```

## License

This project is licensed under the MIT License.