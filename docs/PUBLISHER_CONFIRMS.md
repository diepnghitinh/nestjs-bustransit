# Publisher Confirms & Publish Retry

By default `Publish()` is fire-and-forget: the message is written to the producer channel and the promise resolves immediately. If the channel is closed (for example during a reconnect) the message is lost or the call throws, and a broker nack is never seen.

Two opt-in settings make the publish layer reliable.

## Configuration

```typescript
x.UsingRabbitMq('my-app', (context, cfg) => {
    cfg.Host('localhost', '/', h => { h.Username('guest'); h.Password('guest'); });

    // Wait for the broker ack of every Publish (default timeout 5000ms)
    cfg.UsePublisherConfirms(5000);

    // Retry a failed Publish: channel closed, nack, confirm timeout
    cfg.UsePublishRetry(r => r.Exponential(5, 500, 2));
});
```

`UsePublishRetry` accepts the same strategies as `UseMessageRetry`: `Immediate`, `Interval`, `Intervals`, `Exponential`.

## Behaviour

| Settings | `await Publish()` resolves when | Fails with |
|---|---|---|
| none (default) | message written to the channel | thrown channel error (no retry) |
| `UsePublisherConfirms` | broker acked | `PublishNackError`, `PublishConfirmTimeoutError`, or the channel error |
| + `UsePublishRetry` | broker acked, after up to N retries | the last error, once retries are used up |

The errors are exported from the package root.

## Per-call override

```typescript
await publishEndpoint.Publish(message, undefined, { confirm: true, confirmTimeoutMs: 2000 });
await publishEndpoint.Publish(message, undefined, { retry: false });
```

## Delivery guarantee: at-least-once

Every attempt re-sends the **same `messageId`** (also set as the AMQP `messageId` property). A confirm can time out after the broker has already accepted the message, so the retry may deliver a duplicate. Consumers must be idempotent or de-duplicate on `messageId`.

This is what an outbox relay needs: mark the outbox row as sent only after `Publish()` resolves.

## Limits

- A confirm means the broker took responsibility for the message. It does not mean the message reached a queue: publishing to an exchange with no bound queue is still silently dropped (no `mandatory` flag yet).
- `Send()` (request/response) is not retried or confirmed. Retrying a command that may already have run is not safe.
