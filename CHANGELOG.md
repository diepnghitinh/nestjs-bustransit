# Changelog

## [0.4.0] - 2026-10-11

The RabbitMQ transport was rebuilt so that one failing channel, exchange or consumer no longer
takes down publishing or consuming elsewhere. Exchange names, queue names and bindings are unchanged.

### Fixed
- An exchange or binding deleted while the app runs is declared again within `topologyRefreshMs` (60 s by default). Before, messages to it were dropped until the next reconnect.
- Shutdown keeps to `shutdownTimeoutMs` when the broker stops answering: cancelling consumers counts against the drain budget, and closing channels and the connection gives up after 2 s.
- A channel closed by the broker (404, 406, 403) is replaced. Before, one bad publish made every later publish fail with `Channel closed` until the process restarted.
- Before the first publish to an exchange, the publisher checks that it exists and creates it (fanout, durable) only when it is missing; an existing exchange is used as it is, whatever its type or arguments. Publishing a message whose consumer is not deployed yet no longer kills the producer channel.
- Publish uses publisher confirms: a publish the broker refuses rejects with the broker's reason. Other publishes in flight on the same channel at that moment also reject, and should be retried.
- The x-delayed-message plugin check runs on a throwaway connection with a time limit, so it can neither disturb the main connection nor hang start-up.
- Connection `error` events are handled. A publish made while reconnecting waits up to `readyTimeoutMs` (10 s) for the connection, then up to `publishTimeoutMs` (10 s) for the broker's confirm.
- Shutdown stops consuming and drains messages in progress once, for up to `shutdownTimeoutMs` (30 s), in `beforeApplicationShutdown`, then closes the connection in `onApplicationShutdown`, so publishing works until the end. A message that fails while the bus is shutting down goes back to its queue instead of `<queue>_error`, as in 0.3.x, so a saga step whose `Send` times out during a deploy is delivered again after the restart.
- Each consumer runs on its own channel and restarts on its own, with a doubling delay up to 60 s, after a refused declaration, a closed channel or a cancel from the broker.
- Messages are acked as soon as they are handled. A leftover delay held each ack one second per `.` in the payload.
- A failed message is acked only after its copy in `<queue>_error` or the delayed exchange is confirmed. If it cannot be written, the message goes back to the queue instead of being lost. If the delay exchange was deleted, the message goes to `<queue>_error`; the exchange and its binding come back at the next topology refresh or consumer start. If the check of the delay exchange fails for another reason (connection lost, no answer within `publishTimeoutMs`), the message goes back to the queue and keeps its remaining redelivery attempts. A failed message whose channel already closed is not parked, because the broker delivers it again.
- A failed message whose `<queue>_error` queue was deleted is no longer lost: the queue is re-created, and if the copy cannot be written the message goes back to the queue.
- Messages that are not JSON go to `<queue>_error`.
- `Send` closes its temporary channel and fails fast when no queue has the endpoint name.
- Passwords containing `@`, `:` or `/` work. The vhost is read exactly as before.
- A connection attempt to a broker that does not answer (packets dropped) gives up after `readyTimeoutMs` and is retried, and shutdown no longer waits for it: before, SIGTERM during such an attempt could block until the operating system's TCP timeout.

### Added
- `BusTransitService.getHealth()` returns `{ connected, blocked, consumers }` for health checks.
- `cfg.UseReliability({...})` sets reconnect, ready, publish, send, consumer restart, shutdown and topology refresh (`topologyRefreshMs`) timings. Every value must be a positive number of at most 2147483647 ms (about 24.8 days); larger values are rejected, because Node would turn them into a 1 ms timer.

### Changed
- `IBusTransitBrokerInterface` changed: `start`, `close`, `health` and `publish` return Promises, and `stopConsuming`, `close` and `health` are new. Custom broker implementations must be updated.
- `IPublishEndpoint.Publish` returns `Promise<void>` and rejects when the broker refuses or does not confirm the message. Await it.
- A published message that reaches no queue is logged as `Unroutable message` instead of being dropped silently.
- A consumer without `PrefetchCount` now gets a prefetch of 50. Before, it had no limit.
- Publishes that are not awaited one after the other can reach the broker out of call order. Await each `Publish` when order matters.
- `package.json` declares `engines.node >=20`.
- `peerDependencies` now declare the supported NestJS versions (10 and 11) and `reflect-metadata`.
- Migration: add `await` to every `Publish` call. A publish that is not awaited and fails becomes an unhandled promise rejection.

### Known limitations
- After a delay exchange (`<prefix>:delayed.exchange.<queue>`) is deleted, delayed redelivery resumes at the next topology refresh or consumer start. Meanwhile failed messages go to `<queue>_error`. Delayed messages that come due before that refresh, or while only the binding is missing, are lost; do not delete either.

## [0.3.2] - 2026-02-11
Fix saga on multi node

## [0.3.1] - 2025-12-24
My birthday - Supported saga state persistent

## [0.3.0] - 2025-12-22

### Documentation
- **Organized Documentation**: Moved all documentation files to a dedicated `docs/` directory for better repository structure.
- **New Setup Guide**: Added `docs/ROUTING_SLIPS_SETUP.md` with detailed installation and configuration steps.
- **Cleanup**: Removed outdated and unlinked documentation files, including the "Pattern Comparison" guide.
- **Updated README**: Fixed broken links and improved the documentation section to reflect the new structure.

## [0.2.0] - Previous Version
- Added Saga Pattern support.
- Added Routing Slips pattern.
