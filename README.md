# NestJs Service Bus

This is a powerful NestJS library designed to simplify the integration and management of a **Service Bus** in your applications, utilizing **RabbitMQ** as the message broker. This library particularly stands out for its implementation of the **Saga Pattern**, helping you reliably and consistently manage distributed transactions.

## 📚 Documentation

- **[📖 Complete Documentation Index](./DOCUMENTATION_INDEX.md)** - Find everything in one place
- **[🚀 Routing Slips Quick Start](./ROUTING_SLIPS_QUICKSTART.md)** - Get started in 10 minutes
- **[📘 Routing Slips Guide](./ROUTING_SLIPS.md)** - Full API reference
- **[📕 Saga Compensation Guide](./COMPENSATION.md)** - Event-driven compensation
- **[🔄 Pattern Comparison](./COMPENSATION_PATTERNS_COMPARISON.md)** - Choose the right pattern
- **[⚙️ Retry Strategies](./RETRY_STRATEGIES.md)** - Handle failures gracefully

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

### Quick Links

- **New to routing slips?** → [Quick Start Guide](./ROUTING_SLIPS_QUICKSTART.md)
- **Want to compare patterns?** → [Pattern Comparison](./COMPENSATION_PATTERNS_COMPARISON.md)
- **Need API reference?** → [Routing Slips Documentation](./ROUTING_SLIPS.md)
- **Looking for something specific?** → [Documentation Index](./DOCUMENTATION_INDEX.md)

# Roadmap
- [x] RabbitMq Broker
- [x] Retry Level 1 (Immediate, Interval, Intervals, Exponential)
- [x] Retry Level 2 (Redelivery with all strategies)
- [x] Saga pattern
- [x] Saga compensation
- [x] Routing slips pattern
- [ ] Kafka broker

# Retry Strategies

This library provides comprehensive retry mechanisms with 4 different strategies:

1. **Immediate**: Retry immediately without delay
2. **Interval**: Retry with fixed delay between attempts
3. **Intervals**: Retry with custom delays for each attempt
4. **Exponential**: Retry with exponentially increasing delays (recommended for production)

Each strategy can be used for both:
- **Level 1 (Retry)**: In-memory immediate retries
- **Level 2 (Redelivery)**: Message requeue with delays using RabbitMQ delayed exchange

See the complete guide: [RETRY_STRATEGIES.md](./RETRY_STRATEGIES.md)

Quick example:
```typescript
cfg.ReceiveEndpoint("my-queue", e => {
    e.ConfigureConsumer(MyConsumer, context, c => {
        // Level 1: Fast immediate retries
        c.UseMessageRetry(r => r.Immediate(3));

        // Level 2: Exponential backoff redelivery
        c.UseRedelivery(r => r.Exponential(5, 5000, 2));
        // Delays: 5s, 10s, 20s, 40s, 80s
    });
});
```

# Consumer configure
```javascript
@Global()
@Module({
    imports: [
        BusTransit.AddBusTransit.Setup((x) => {

            x.AddConsumer(SubmitOrderConsumer,);

            x.UsingRabbitMq(configService.get('APP_NAME'), (context, cfg) =>
            {
                cfg.Host(configService.get('RMQ_HOST'), configService.get('RMQ_VHOST'), (h) =>
                {
                    h.Username(configService.get('RMQ_USERNAME'));
                    h.Password(configService.get('RMQ_PASSWORD'));
                });

                cfg.ReceiveEndpoint("regular-orders-1", e => {
                    e.PrefetchCount = 30;
                    e.ConfigureConsumer(SubmitOrderConsumer, context, c => {
                        c.UseMessageRetry(r => r.Immediate(5)); // Retry 5 times immediately
                        c.UseRedelivery(r => r.Exponential(5, 5000, 2)); // Exponential backoff
                    });
                });

            })
        }),
    ],
    controllers: [],
    providers: [],
})
export class MessagingInfrastructureModule {}
```

To use a Producer instance, inject it into the Consumer constructor with the IPublishEndpoint interface.
```javascript
export class OrderMessage {
    @IsNotEmpty()
    Text: string;
}

@Injectable()
export class SubmitOrderConsumer extends BusTransitConsumer<OrderMessage> {

    constructor(
        @Inject(IPublishEndpoint)
        private readonly publishEndpoint: IPublishEndpoint,
    ) {
        super(OrderMessage);
    }

    async Consume(ctx, context) {
        await super.Consume(ctx, context)
        Logger.debug('SubmitOrderConsumer receive')

        // Active a Saga flow
        const rs = await this.publishEndpoint.Send<OrderSubmitted>(new OrderSubmitted(
            {
                OrderId: uuidv7(),
                Total: 10000,
                Email: 'test@gmail.com'
            }
        ), null);

        console.log(context.Message);
        console.log(rs);
    }
}
```

# Saga Configure
See details <a href="https://github.com/diepnghitinh/nestjs-bustransit/tree/main/example/src/infrastructure/messaging/sagas" target="_blank">saga consumer</a> & Workflow

![Saga](./docs/saga.png)

## Saga Compensation Pattern
The library now supports automatic compensation for failed sagas. Define compensation actions for each step, and they'll automatically execute in reverse order when a failure occurs.

See the complete guide: [COMPENSATION.md](./COMPENSATION.md)

Quick example:
```typescript
this.When(PaymentProcessed)
    .Then(c => {
        c.Saga.PaymentIntentId = c.Message.PaymentIntentId;
    })
    .PublishAsync<ReserveInventory>(ReserveInventory, c => {
        // Forward transaction
        return new ReserveInventory();
    })
    .Compensate(async c => {
        // Compensation transaction - refund the payment
        await refundPayment(c.Saga.PaymentIntentId);
    })
    .TransitionTo(this.ReservingInventory)
```

## Routing Slips Pattern
The library implements the Routing Slips pattern for distributed transaction coordination based on [MassTransit's Routing Slips](https://masstransit.io/documentation/concepts/routing-slips). This provides an activity-based approach to orchestrating multi-service workflows with automatic compensation.

**Key Features:**
- **Activity-based coordination** - Reusable, self-contained processing units
- **Automatic compensation** - Activities compensate in reverse order (LIFO) on failure
- **Dynamic itineraries** - Build workflows at runtime based on conditions
- **Rich event system** - Monitor execution with detailed events
- **Variable passing** - Share data between activities seamlessly

See the complete guide: [ROUTING_SLIPS.md](./ROUTING_SLIPS.md)

Quick example:
```typescript
// Define an activity with compensation
@Injectable()
export class ProcessPaymentActivity implements IActivity<PaymentArgs, PaymentLog> {
    name = 'ProcessPayment';

    async execute(context: IExecuteContext<PaymentArgs>): Promise<IActivityResult> {
        const paymentId = await this.processPayment(context.arguments);
        return context.completedWithVariables(
            new Map([['paymentId', paymentId]]),
            { paymentId, amount: context.arguments.amount }
        );
    }

    async compensate(context: ICompensateContext<PaymentLog>): Promise<void> {
        await this.refundPayment(context.compensationLog.paymentId);
    }
}

// Build and execute a routing slip
const routingSlip = RoutingSlipBuilder.create('order-123')
    .addActivity('ProcessPayment', 'payment-service', { orderId: 'order-123', amount: 99.99 })
    .addActivity('ReserveInventory', 'inventory-service', { orderId: 'order-123', items: [...] })
    .addActivity('SendConfirmation', 'notification-service', { email: 'customer@example.com' })
    .build();

await executor.execute(routingSlip);
```

**When to use Routing Slips vs Saga Compensation:**
- **Routing Slips**: Multi-service workflows, dynamic orchestration, reusable activities
- **Saga Compensation**: Complex state machines, long-running processes, event-driven flows

Code configure
```javascript
@Global()
@Module({
    imports: [
        BusTransit.AddBusTransit.setUp((x) => {

            x.AddConsumer(ProcessPaymentConsumer,).Endpoint(e => {
                e.Name = "saga-process-payment"
            });
            x.AddConsumer(ReserveInventoryConsumer,).Endpoint(e => {
                e.Name = "saga-reserve-inventory"
            });
            x.AddConsumer(OrderConfirmedConsumer,).Endpoint(e => {
                e.Name = "saga-order-confirmed"
            });
            x.AddConsumer(OrderRefundConsumer,).Endpoint(e => {
                e.Name = "saga-order-refund"
            });

            x.AddSagaStateMachine(OrderStateMachine, OrderState);

            x.UsingRabbitMq(configService.get('APP_NAME'), (context, cfg) =>
            {
                cfg.PrefetchCount = 50;

                cfg.Host(configService.get('RMQ_HOST'), configService.get('RMQ_VHOST'), (h) =>
                {
                    h.Username(configService.get('RMQ_USERNAME'));
                    h.Password(configService.get('RMQ_PASSWORD'));
                });

                // Others services saga
                cfg.ReceiveEndpoint("saga-process-payment", e => {
                    e.ConfigureConsumer(ProcessPaymentConsumer, context, c => {
                    });
                });

                cfg.ReceiveEndpoint("saga-reserve-inventory", e => {
                    e.ConfigureConsumer(ReserveInventoryConsumer, context, c => {
                    });
                });

                cfg.ReceiveEndpoint("saga-order-confirmed", e => {
                    e.ConfigureConsumer(OrderConfirmedConsumer, context, c => {
                    });
                });

                cfg.ReceiveEndpoint("saga-order-refund", e => {
                    e.ConfigureConsumer(OrderRefundConsumer, context, c => {
                    });
                });
            })
        })
    ],
    controllers: [
    ],
    providers: [
    ],
})
export class MessagingInfrastructureModule {}
```