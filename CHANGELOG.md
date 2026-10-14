# Changelog

## [Unreleased]
- Publisher confirms: `UsePublisherConfirms(timeoutMs)` makes `Publish()` wait for the broker ack.
- Publish retry: `UsePublishRetry(r => ...)` retries nack, confirm timeout and closed-channel failures, re-sending the same `messageId`.
- `Publish()` accepts per-call `{ confirm, confirmTimeoutMs, retry }` and now returns `Promise<void>`.
- New errors: `PublishNackError`, `PublishConfirmTimeoutError`, `PublishChannelUnavailableError`.
- Default behaviour unchanged (fire-and-forget). See `docs/PUBLISHER_CONFIRMS.md`.

## [0.3.3] - 2026-02-11
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
