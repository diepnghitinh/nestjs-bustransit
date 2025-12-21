# RabbitMQ x-delayed-message Plugin Detection

## Overview

The library now includes automatic detection of the RabbitMQ `x-delayed-message` plugin and conditionally enables redelivery features based on plugin availability.

## How It Works

### 1. Multi-Layer Plugin Detection

The library uses **two levels of plugin detection** for maximum safety:

#### Level 1: Startup Detection
When the RabbitMQ connection is established:

```typescript
// Creates a temporary test channel
// Attempts to create a delayed exchange
// If successful: plugin is available ✓
// If fails: plugin is not available ⚠
```

**Key Features:**
- Uses a **separate temporary channel** for testing to avoid affecting the main connection
- Handles errors gracefully without crashing the application
- Logs clear status messages

#### Level 2: Runtime Validation
When creating the actual delayed exchange for each queue:

```typescript
try {
    await this.assertExchange(channel, delayExchange, 'x-delayed-message', {...});
    await channel.bindQueue(queueName, delayExchange, '');
    // Success: Redelivery enabled ✓
} catch (error) {
    // Failed: Disable redelivery for this and all future queues
    // Update global plugin flag
    // Log detailed error message
}
```

**Why Two Levels?**
- Handles edge cases where plugin status changes between startup and runtime
- Protects against permission issues
- Prevents channel closure from crashing the application
- Provides detailed error information for troubleshooting

### 2. Conditional Redelivery Enablement

Redelivery is **only enabled** when **BOTH** conditions are met:
1. ✅ Redelivery pattern is configured in the consumer
2. ✅ x-delayed-message plugin is available

| Plugin Available | Redelivery Configured | Result |
|-----------------|----------------------|--------|
| ✓ Yes           | ✓ Yes                | **Redelivery ENABLED** |
| ✗ No            | ✓ Yes                | **Redelivery DISABLED** (warning logged) |
| ✓ Yes           | ✗ No                 | **Redelivery DISABLED** |
| ✗ No            | ✗ No                 | **Redelivery DISABLED** |

### 3. Graceful Degradation

When the plugin is not available:
- Consumer setup continues without errors
- Redelivery is automatically disabled
- Clear warnings are logged
- Failed messages go directly to error queue (no retry)

## Log Messages

### Startup - Plugin Available
```
[RabbitMQ] ✓ x-delayed-message plugin is available
[RabbitMQ] Redelivery enabled for queue 'order-queue'
```

### Startup - Plugin Not Available
```
[RabbitMQ] ⚠ WARNING: x-delayed-message plugin is NOT installed or not enabled.
Delayed/scheduled message features will not work.
Please install the plugin: https://github.com/rabbitmq/rabbitmq-delayed-message-exchange

[RabbitMQ] Redelivery pattern configured for queue 'order-queue' but x-delayed-message plugin is NOT available.
Redelivery is DISABLED. Install plugin: https://github.com/rabbitmq/rabbitmq-delayed-message-exchange
```

### Runtime - Exchange Creation Failed
```
[RabbitMQ] ✗ Failed to create delayed exchange for queue 'order-queue'.
Error: PRECONDITION_FAILED - unknown exchange type 'x-delayed-message'. Redelivery is DISABLED.

[RabbitMQ] This may indicate the x-delayed-message plugin became unavailable
or there are permission issues. All queues will have redelivery disabled.
```

### Runtime - Message Failure (Plugin Not Available)
```
[RabbitMQ] Redelivery pattern configured but DISABLED for queue 'order-queue' -
x-delayed-message plugin not available. Message will be sent to error queue.
```

## Programmatic API

Check plugin and redelivery status programmatically:

```typescript
import { BusTransitBrokerRabbitMqFactory } from 'nestjs-bustransit';

// Check if plugin is available globally
const isPluginAvailable = broker.isDelayedMessagePluginSupported();

// Check if redelivery is enabled for a specific queue
const isRedeliveryEnabled = broker.isRedeliveryEnabledForQueue('order-queue');
```

## Installing the x-delayed-message Plugin

### Docker
```dockerfile
FROM rabbitmq:3.12-management-alpine

RUN apk add --no-cache curl

RUN curl -L https://github.com/rabbitmq/rabbitmq-delayed-message-exchange/releases/download/v3.12.0/rabbitmq_delayed_message_exchange-3.12.0.ez \
    -o $RABBITMQ_HOME/plugins/rabbitmq_delayed_message_exchange-3.12.0.ez

RUN rabbitmq-plugins enable rabbitmq_delayed_message_exchange
```

### Manual Installation
```bash
# Download the plugin
cd /path/to/rabbitmq/plugins
wget https://github.com/rabbitmq/rabbitmq-delayed-message-exchange/releases/download/v3.12.0/rabbitmq_delayed_message_exchange-3.12.0.ez

# Enable the plugin
rabbitmq-plugins enable rabbitmq_delayed_message_exchange

# Restart RabbitMQ
rabbitmqctl stop_app
rabbitmqctl start_app
```

### Verify Installation
```bash
rabbitmq-plugins list | grep delayed
# Should show: [E*] rabbitmq_delayed_message_exchange
```

## Benefits

1. **No Application Crashes**: Uses isolated test channel that doesn't affect main connection
2. **Clear Feedback**: Explicit warnings when plugin is missing
3. **Automatic Adaptation**: Redelivery automatically disabled when plugin unavailable
4. **Production Ready**: Graceful degradation allows application to run even without plugin
5. **Developer Friendly**: Clear instructions on how to install and enable the plugin

## Error Resolution

If you see the error:
```
Error: Channel closed by server: 406 (PRECONDITION-FAILED) with message
"PRECONDITION_FAILED - unknown exchange type 'x-delayed-message'"
```

**Solution:** Install the x-delayed-message plugin (see installation instructions above)

**Temporary Workaround:** Remove redelivery configuration from your consumers until plugin is installed
