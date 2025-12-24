# Saga State Persistence

## Overview

The Saga Persistence module enables production-ready state management for saga state machines by providing database persistence with support for MongoDB, PostgreSQL, and in-memory storage.

## Features

- **Multiple Storage Adapters**: InMemory (default), MongoDB, PostgreSQL
- **Optimistic Locking**: Prevents concurrent update conflicts with version tracking
- **Auto-Archiving**: Configurable TTL-based cleanup for completed sagas
- **Retry Logic**: Configurable retry with exponential backoff for transient failures
- **Type Safety**: Generic repository with proper serialization/deserialization
- **Backward Compatible**: Defaults to in-memory, no breaking changes to existing code
- **Async Configuration**: Integration with NestJS ConfigService

## Quick Start

### 1. In-Memory (Default)

No configuration needed - sagas automatically use in-memory storage:

```typescript
@Module({
    imports: [
        BusTransit.AddBusTransit.setUp(bus => {
            bus.AddSagaStateMachine(OrderStateMachine, OrderState);
        })
    ]
})
export class AppModule {}
```

### 2. MongoDB Persistence

Install dependencies:
```bash
npm install mongoose
```

Configure the module:
```typescript
import { SagaPersistenceModule, SagaPersistenceType } from 'nestjs-bustransit';

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

### 3. PostgreSQL Persistence

Install dependencies:
```bash
npm install @nestjs/typeorm typeorm pg
```

Configure the module:
```typescript
@Module({
    imports: [
        SagaPersistenceModule.forRoot({
            type: SagaPersistenceType.PostgreSQL,
            connection: {
                host: 'localhost',
                port: 5432,
                username: 'postgres',
                password: 'password',
                database: 'bustransit',
                tableName: 'saga_states'
            },
            autoArchive: true
        }),
        BusTransit.AddBusTransit.setUp(bus => {
            bus.AddSagaStateMachine(OrderStateMachine, OrderState);
        })
    ]
})
export class AppModule {}
```

## How It Works

### Saga Lifecycle with Persistence

1. **Event Arrives**: Message broker delivers event to saga consumer
2. **Correlation**: Extract CorrelationId from event (e.g., OrderId)
3. **Load State**: Repository loads existing saga or creates new instance
4. **Execute Workflow**: Run saga logic (Then, PublishAsync, TransitionTo)
5. **Save State**: Repository persists updated saga state
6. **Finalize** (optional): Archive or delete completed saga

### State Storage Schema

Each saga instance is stored with:

```typescript
{
    correlationId: string      // Unique saga identifier
    currentState: string       // Current state name (e.g., "ProcessingPayment")
    sagaType: string          // Saga class name (e.g., "OrderState")
    data: object              // Full saga state (all custom fields)
    version: number           // For optimistic locking
    createdAt: Date          // When saga was created
    updatedAt: Date          // Last update timestamp
    archivedAt?: Date        // Soft delete timestamp (if archived)
}
```

### Custom Saga Fields

Your saga state class automatically persists all fields:

```typescript
export class OrderState extends SagaStateMachineInstance {
    // Framework fields (always present)
    public CorrelationId: string;
    public CurrentState: string;

    // Your custom business data (automatically persisted)
    public OrderTotal: number;
    public PaymentIntentId: string;
    public OrderDate: Date;
    public CustomerEmail: string;
    public WarehouseId: string;
}
```

## Configuration Options

### Complete Options Reference

```typescript
interface SagaPersistenceOptions {
    // Storage type
    type: SagaPersistenceType.InMemory | MongoDB | PostgreSQL | Custom;

    // Database connection
    connection?: {
        // MongoDB
        uri?: string;
        database?: string;
        collectionName?: string;

        // PostgreSQL
        host?: string;
        port?: number;
        username?: string;
        password?: string;
        schema?: string;
        tableName?: string;

        // Common
        poolSize?: number;
        ssl?: boolean;
        connectionTimeout?: number;
    };

    // Archiving
    autoArchive?: boolean;        // Archive instead of delete (default: false)
    archiveTTL?: number;          // TTL in seconds (MongoDB only)

    // Advanced
    autoCreateSchema?: boolean;   // Auto-create tables/collections (default: true)
    customRepository?: Type;      // Custom repository implementation
    serializer?: Type;            // Custom serializer

    // Retry configuration
    retry?: {
        attempts?: number;        // Default: 3
        delay?: number;          // Milliseconds, default: 100
        exponentialBackoff?: boolean; // Default: true
    };
}
```

## Async Configuration

Use `forRootAsync()` to integrate with ConfigService:

```typescript
@Module({
    imports: [
        ConfigModule.forRoot(),
        SagaPersistenceModule.forRootAsync({
            imports: [ConfigModule],
            useFactory: (config: ConfigService) => ({
                type: config.get('SAGA_PERSISTENCE_TYPE'),
                connection: {
                    host: config.get('DB_HOST'),
                    port: config.get('DB_PORT'),
                    username: config.get('DB_USER'),
                    password: config.get('DB_PASS'),
                    database: config.get('DB_NAME')
                },
                autoArchive: config.get('SAGA_AUTO_ARCHIVE', true),
                retry: {
                    attempts: config.get('SAGA_RETRY_ATTEMPTS', 5),
                    delay: config.get('SAGA_RETRY_DELAY', 200)
                }
            }),
            inject: [ConfigService]
        }),
        BusTransit.AddBusTransit.setUp(/* ... */)
    ]
})
export class AppModule {}
```

## Auto-Archiving

### MongoDB TTL Index

MongoDB automatically deletes archived sagas after TTL expires:

```typescript
SagaPersistenceModule.forRoot({
    type: SagaPersistenceType.MongoDB,
    autoArchive: true,
    archiveTTL: 86400 * 30  // Delete after 30 days
})
```

### PostgreSQL Archiving

PostgreSQL uses soft delete (sets `archivedAt` timestamp). To automatically cleanup:

```typescript
// Option 1: Manual cleanup query
DELETE FROM saga_states
WHERE "archivedAt" IS NOT NULL
  AND "archivedAt" < NOW() - INTERVAL '30 days';

// Option 2: Use pg_cron extension
SELECT cron.schedule(
    'cleanup-archived-sagas',
    '0 2 * * *',  -- Daily at 2 AM
    $$DELETE FROM saga_states
      WHERE "archivedAt" IS NOT NULL
        AND "archivedAt" < NOW() - INTERVAL '30 days'$$
);
```

## Optimistic Locking

Prevents concurrent updates to the same saga:

```typescript
// Saga A loads order saga (version 5)
const sagaA = await repository.findByCorrelationId('order-123');

// Saga B loads same order saga (version 5)
const sagaB = await repository.findByCorrelationId('order-123');

// Saga A saves successfully (version → 6)
await repository.save(sagaA);  // ✅ Success

// Saga B tries to save (still version 5)
await repository.save(sagaB);  // ❌ ConcurrencyException thrown
```

The framework automatically handles this by retrying the entire saga operation.

## Error Handling

### Retry Configuration

```typescript
SagaPersistenceModule.forRoot({
    retry: {
        attempts: 5,           // Retry up to 5 times
        delay: 100,           // Start with 100ms delay
        exponentialBackoff: true  // 100ms → 200ms → 400ms → 800ms → 1600ms
    }
})
```

### Transient vs Permanent Errors

**Retried automatically:**
- Connection timeouts
- Deadlocks
- Network errors
- Replica set failover (MongoDB)

**Fail immediately:**
- Validation errors
- Constraint violations
- Authentication failures
- Optimistic locking conflicts (handled by framework)

## Database Indexes

### MongoDB Indexes

Automatically created indexes:
```javascript
db.saga_states.createIndex({ correlationId: 1 }, { unique: true })
db.saga_states.createIndex({ currentState: 1 })
db.saga_states.createIndex({ sagaType: 1 })
db.saga_states.createIndex({ sagaType: 1, currentState: 1 })
db.saga_states.createIndex({ archivedAt: 1 }, {
    expireAfterSeconds: 2592000,  // TTL
    partialFilterExpression: { archivedAt: { $ne: null } }
})
```

### PostgreSQL Indexes

Automatically created indexes:
```sql
CREATE UNIQUE INDEX saga_states_pkey ON saga_states (correlationId);
CREATE INDEX idx_saga_current_state ON saga_states (currentState);
CREATE INDEX idx_saga_type ON saga_states (sagaType);
CREATE INDEX idx_saga_type_state ON saga_states (sagaType, currentState);
CREATE INDEX idx_saga_archived ON saga_states (archivedAt) WHERE archivedAt IS NOT NULL;
```

## Performance Considerations

### Connection Pooling

```typescript
SagaPersistenceModule.forRoot({
    connection: {
        poolSize: 10  // MongoDB
    }
})
```

### Query Optimization

Use indexed fields for queries:
```typescript
// ✅ Good - uses index
await repository.findByState('ProcessingPayment');

// ✅ Good - uses index
await repository.find({ sagaType: 'OrderState' });

// ⚠️ Slower - full table scan
await repository.find({ 'data.customerEmail': 'user@example.com' });
```

### JSONB Queries (PostgreSQL)

Query custom fields efficiently:
```sql
-- Create GIN index for JSONB queries
CREATE INDEX idx_saga_data_gin ON saga_states USING GIN (data);

-- Fast queries
SELECT * FROM saga_states WHERE data @> '{"customerEmail": "user@example.com"}';
```

## Migration Guide

See [SAGA_PERSISTENCE_MIGRATION.md](./SAGA_PERSISTENCE_MIGRATION.md) for detailed migration instructions.

## Troubleshooting

### "Cannot find module 'mongoose'"

Install the required peer dependency:
```bash
npm install mongoose
```

### "Optimistic locking failed"

This is expected when concurrent updates occur. The framework automatically retries the saga operation. If you see this frequently, you may have duplicate message consumers - check your queue configuration.

### Saga state not persisting

1. Verify `SagaPersistenceModule` is imported **before** `BusTransit.AddBusTransit`
2. Check database connection logs
3. Ensure saga has `CorrelationId` set before save
4. Verify database permissions

### MongoDB TTL not working

1. TTL index only works on replica sets (not standalone)
2. Background task runs every 60 seconds (not immediate)
3. Verify index exists: `db.saga_states.getIndexes()`

## Best Practices

1. **Always use persistence in production** - In-memory is for development only
2. **Enable auto-archiving** - Prevents unbounded growth
3. **Set appropriate TTL** - Balance audit requirements vs storage costs
4. **Monitor saga counts** - Use `repository.count()` in health checks
5. **Index custom fields** - If you frequently query saga business data
6. **Use connection pooling** - Configure appropriate pool sizes
7. **Handle version conflicts gracefully** - Let the framework retry

## Next Steps

- [Configuration Guide](./SAGA_PERSISTENCE_CONFIGURATION.md) - Detailed configuration options
- [Migration Guide](./SAGA_PERSISTENCE_MIGRATION.md) - Migrate from in-memory to persistent storage
- [Recovery Tools](./SAGA_RECOVERY_TOOLS.md) - Monitor and recover stuck sagas (coming soon)

## Related Documentation

- [Routing Slips](./ROUTING_SLIPS.md) - Sequential activity chains with compensation
- [Compensation](./COMPENSATION.md) - Handling failures in distributed transactions
- [Retry Strategies](./RETRY_STRATEGIES.md) - Configure message retry behavior
