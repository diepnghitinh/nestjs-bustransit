# Retry Strategies Documentation

This library provides a comprehensive retry mechanism with two levels of retry strategies for handling message processing failures in distributed systems.

## Overview

The retry system has two levels:

1. **Retry (Level 1)**: Immediate in-memory retries using RxJS operators
2. **Redelivery (Level 2)**: Message requeue with delays using RabbitMQ's delayed exchange plugin

## Retry Strategies

### 1. Immediate Retry

Retries the message processing immediately without any delay.

**Configuration:**
```typescript
c.UseMessageRetry(r => r.Immediate(5)); // Retry 5 times immediately
```

**Characteristics:**
- Zero delay between retries
- Fast for transient errors
- Uses in-memory retry (Level 1)
- No additional queue overhead

**Use Cases:**
- Temporary network glitches
- Brief resource unavailability
- Race conditions that resolve quickly

**Example:**
```typescript
cfg.ReceiveEndpoint("my-queue", e => {
    e.ConfigureConsumer(MyConsumer, context, c => {
        c.UseMessageRetry(r => r.Immediate(3)); // 3 immediate retries
    });
});
```

---

### 2. Interval Retry

Retries with a fixed delay between each attempt.

**Configuration:**
```typescript
c.UseMessageRetry(r => r.Interval(5, 2000)); // 5 retries with 2-second intervals
```

**Parameters:**
- `retryCount`: Number of retry attempts
- `delay`: Fixed delay in milliseconds between retries

**Characteristics:**
- Fixed delay between attempts
- Predictable retry timing
- Can be used for both Level 1 (retry) and Level 2 (redelivery)

**Use Cases:**
- API rate limiting
- Database connection issues
- Service warm-up time

**Example:**
```typescript
cfg.ReceiveEndpoint("my-queue", e => {
    e.ConfigureConsumer(MyConsumer, context, c => {
        // Level 1: Immediate retry with fixed intervals
        c.UseMessageRetry(r => r.Interval(3, 1000)); // 3 retries, 1 second apart

        // Level 2: Redelivery with fixed intervals
        c.UseRedelivery(r => r.Interval(5, 5000)); // 5 redeliveries, 5 seconds apart
    });
});
```

---

### 3. Intervals (Custom Delays)

Retries with custom delays for each attempt.

**Configuration:**
```typescript
c.UseMessageRetry(r => r.Intervals(1000, 2000, 5000, 10000));
```

**Parameters:**
- `...delays`: Variable number of delay values in milliseconds

**Characteristics:**
- Custom delay for each retry attempt
- Maximum retries = number of delay values
- Full control over retry timing
- Useful for progressive backoff

**Use Cases:**
- Custom escalation patterns
- Specific business requirements
- Complex retry scenarios

**Example:**
```typescript
cfg.ReceiveEndpoint("my-queue", e => {
    e.ConfigureConsumer(MyConsumer, context, c => {
        // Level 1: Try quickly at first, then wait longer
        c.UseMessageRetry(r => r.Intervals(100, 500, 1000));

        // Level 2: Long delays for redelivery
        c.UseRedelivery(r => r.Intervals(5000, 15000, 30000, 60000));
    });
});
```

---

### 4. Exponential Backoff

Retries with exponentially increasing delays between attempts.

**Configuration:**
```typescript
c.UseMessageRetry(r => r.Exponential(5, 1000, 2));
// 5 retries: 1s, 2s, 4s, 8s, 16s
```

**Parameters:**
- `retryCount`: Number of retry attempts
- `initialDelay`: Initial delay in milliseconds (default: 1000ms)
- `scalingFactor`: Multiplier for each subsequent delay (default: 2)

**Formula:**
```
delay = initialDelay * (scalingFactor ^ attemptNumber)
```

**Characteristics:**
- Delays increase exponentially
- Reduces load on failing services
- Industry standard approach
- Recommended for most scenarios

**Use Cases:**
- External API failures
- Database connection issues
- Service overload situations
- Production environments

**Example:**
```typescript
cfg.ReceiveEndpoint("my-queue", e => {
    e.ConfigureConsumer(MyConsumer, context, c => {
        // Level 1: Quick exponential retry
        c.UseMessageRetry(r => r.Exponential(3, 500, 2)); // 500ms, 1s, 2s

        // Level 2: Longer exponential redelivery
        c.UseRedelivery(r => r.Exponential(5, 5000, 2)); // 5s, 10s, 20s, 40s, 80s
    });
});
```

---

## Two-Level Retry System

### Level 1: Retry (In-Memory)

**How it works:**
- Uses RxJS operators for in-memory retry
- Fast and immediate
- No message requeue
- Processing happens in the same consumer instance

**Configuration:**
```typescript
c.UseMessageRetry(r => {
    // Choose one strategy
    r.Immediate(5);
    // OR
    r.Interval(3, 1000);
    // OR
    r.Intervals(100, 500, 1000);
    // OR
    r.Exponential(3, 500, 2);
});
```

### Level 2: Redelivery (Message Requeue)

**How it works:**
- Uses RabbitMQ's x-delayed-message exchange plugin
- Messages are requeued with a delay
- Can be picked up by any consumer instance
- Survives consumer restarts

**Configuration:**
```typescript
c.UseRedelivery(r => {
    // Choose one strategy
    r.Interval(5, 5000);
    // OR
    r.Intervals(5000, 15000, 30000);
    // OR
    r.Exponential(5, 5000, 2);
});
```

**Requirements:**
- RabbitMQ delayed message exchange plugin must be installed
- Plugin URL: https://github.com/rabbitmq/rabbitmq-delayed-message-exchange

---

## Complete Example

```typescript
@Global()
@Module({
    imports: [
        BusTransit.AddBusTransit.Setup((x) => {
            x.AddConsumer(OrderConsumer);
            x.AddConsumer(PaymentConsumer);

            x.UsingRabbitMq(configService.get('APP_NAME'), (context, cfg) => {
                cfg.Host(configService.get('RMQ_HOST'), configService.get('RMQ_VHOST'), (h) => {
                    h.Username(configService.get('RMQ_USERNAME'));
                    h.Password(configService.get('RMQ_PASSWORD'));
                });

                // Order processing - aggressive retry for transient errors
                cfg.ReceiveEndpoint("order-queue", e => {
                    e.PrefetchCount = 30;
                    e.ConfigureConsumer(OrderConsumer, context, c => {
                        // Level 1: Quick immediate retries for transient issues
                        c.UseMessageRetry(r => r.Immediate(3));

                        // Level 2: Exponential backoff redelivery for persistent issues
                        c.UseRedelivery(r => r.Exponential(5, 5000, 2));
                    });
                });

                // Payment processing - careful retry with fixed delays
                cfg.ReceiveEndpoint("payment-queue", e => {
                    e.PrefetchCount = 10;
                    e.ConfigureConsumer(PaymentConsumer, context, c => {
                        // Level 1: Fixed interval retry to avoid overwhelming payment API
                        c.UseMessageRetry(r => r.Interval(3, 2000));

                        // Level 2: Custom intervals for payment reconciliation
                        c.UseRedelivery(r => r.Intervals(10000, 30000, 60000, 300000));
                    });
                });
            });
        }),
    ],
})
export class MessagingModule {}
```

---

## Error Tracking

The retry system automatically tracks retry attempts in message headers:

```typescript
{
    "x-retry-count": 3,        // Number of Level 1 (immediate) retries
    "x-redelivery": 2          // Number of Level 2 (redelivery) attempts
}
```

Failed messages are moved to an error queue with full retry history:

```typescript
{
    "message": { /* original message */ },
    "error": {
        "message": "Error description",
        "stack": "Error stack trace",
        "timestamp": "2025-12-19T10:30:00.000Z"
    },
    "retryHistory": {
        "immediateRetries": 3,
        "redeliveryAttempts": 5
    },
    "host": {
        "machineName": "server-1",
        "processId": 12345,
        "processName": "node"
    }
}
```

---

## Best Practices

### 1. Start with Immediate Retry

For transient errors, always use Level 1 immediate retry first:
```typescript
c.UseMessageRetry(r => r.Immediate(3));
```

### 2. Use Exponential Backoff for Redelivery

For production systems, exponential backoff is recommended:
```typescript
c.UseRedelivery(r => r.Exponential(5, 5000, 2));
```

### 3. Combine Both Levels

Use both retry levels for comprehensive error handling:
```typescript
c.UseMessageRetry(r => r.Immediate(3));        // Fast retries first
c.UseRedelivery(r => r.Exponential(5, 5000, 2)); // Then exponential backoff
```

### 4. Consider Your Use Case

- **High-frequency messages**: Use shorter delays
- **External APIs**: Use exponential backoff
- **Database issues**: Use interval retry with moderate delays
- **Rate-limited APIs**: Use custom intervals matching rate limits

### 5. Monitor Error Queues

Always monitor `{queue-name}_error` queues for messages that failed all retries.

### 6. Set Reasonable Limits

Don't retry forever:
- Level 1: 3-5 immediate retries
- Level 2: 5-7 redelivery attempts
- Total time: Should not exceed your business requirements

### 7. Log Appropriately

The library automatically logs:
- Each retry attempt with timing
- Retry strategy details
- When max attempts are reached
- Error queue movements

---

## Retry Strategy Comparison

| Strategy | Use Case | Pros | Cons |
|----------|----------|------|------|
| **Immediate** | Transient errors | Fast, no delay | Can overwhelm failing service |
| **Interval** | Rate limiting | Predictable timing | Fixed delay may not be optimal |
| **Intervals** | Custom patterns | Full control | Requires careful planning |
| **Exponential** | Production default | Reduces load, industry standard | Delays can become very long |

---

## Troubleshooting

### Messages not being retried

1. Check that the consumer configuration includes retry setup
2. Verify RabbitMQ connection is active
3. Check consumer error logs

### Redelivery not working

1. Ensure RabbitMQ delayed message exchange plugin is installed:
   ```bash
   rabbitmq-plugins enable rabbitmq_delayed_message_exchange
   ```
2. Verify delayed exchange is created: `delayed.exchange.{queue-name}`
3. Check RabbitMQ logs for errors

### Too many retries

1. Reduce retry counts in configuration
2. Implement better error handling in consumer logic
3. Check if errors are actually recoverable

### Messages going to error queue too quickly

1. Increase retry counts
2. Add redelivery configuration if only using retry
3. Review error logs to understand failure reasons

---

## Advanced Configuration

### Circuit Breaker Pattern

While not built-in, you can implement circuit breaker logic in your consumers:

```typescript
async Consume(ctx, context) {
    if (this.circuitBreaker.isOpen()) {
        throw new Error('Circuit breaker open');
    }

    try {
        // Process message
        this.circuitBreaker.recordSuccess();
    } catch (error) {
        this.circuitBreaker.recordFailure();
        throw error;
    }
}
```

### Custom Error Handling

You can implement custom error handling based on error types:

```typescript
async Consume(ctx, context) {
    try {
        // Process message
    } catch (error) {
        if (error instanceof ValidationError) {
            // Don't retry validation errors
            Logger.error('Validation failed, moving to error queue');
            return; // Message will be acknowledged and not retried
        }
        throw error; // Other errors will be retried
    }
}
```

---

## Migration Guide

### From No Retry to With Retry

**Before:**
```typescript
cfg.ReceiveEndpoint("my-queue", e => {
    e.ConfigureConsumer(MyConsumer, context);
});
```

**After:**
```typescript
cfg.ReceiveEndpoint("my-queue", e => {
    e.ConfigureConsumer(MyConsumer, context, c => {
        c.UseMessageRetry(r => r.Immediate(3));
        c.UseRedelivery(r => r.Exponential(5, 5000, 2));
    });
});
```

### From Simple to Advanced

**Start Simple:**
```typescript
c.UseMessageRetry(r => r.Immediate(5));
```

**Add Redelivery:**
```typescript
c.UseMessageRetry(r => r.Immediate(3));
c.UseRedelivery(r => r.Interval(5, 5000));
```

**Optimize for Production:**
```typescript
c.UseMessageRetry(r => r.Immediate(3));
c.UseRedelivery(r => r.Exponential(7, 5000, 2));
```
