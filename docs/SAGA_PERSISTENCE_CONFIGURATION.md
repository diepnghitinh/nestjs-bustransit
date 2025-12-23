# Saga Persistence Configuration Guide

## Table of Contents

- [Installation](#installation)
- [Basic Configuration](#basic-configuration)
- [MongoDB Configuration](#mongodb-configuration)
- [PostgreSQL Configuration](#postgresql-configuration)
- [Environment-Based Configuration](#environment-based-configuration)
- [Advanced Options](#advanced-options)
- [Custom Repository](#custom-repository)

## Installation

### MongoDB

```bash
npm install mongoose
```

### PostgreSQL

```bash
npm install @nestjs/typeorm typeorm pg
```

### In-Memory (No Installation Required)

The in-memory adapter is included by default and requires no additional dependencies.

## Basic Configuration

### In-Memory (Default)

```typescript
import { Module } from '@nestjs/common';
import { BusTransit } from 'nestjs-bustransit';

@Module({
    imports: [
        // No persistence module needed
        BusTransit.AddBusTransit.setUp(bus => {
            bus.AddSagaStateMachine(OrderStateMachine, OrderState);
        })
    ]
})
export class AppModule {}
```

### Explicit In-Memory Configuration

```typescript
import { SagaPersistenceModule, SagaPersistenceType } from 'nestjs-bustransit';

@Module({
    imports: [
        SagaPersistenceModule.forRoot({
            type: SagaPersistenceType.InMemory
        }),
        BusTransit.AddBusTransit.setUp(/* ... */)
    ]
})
export class AppModule {}
```

## MongoDB Configuration

### Basic MongoDB

```typescript
import { SagaPersistenceModule, SagaPersistenceType } from 'nestjs-bustransit';

@Module({
    imports: [
        SagaPersistenceModule.forRoot({
            type: SagaPersistenceType.MongoDB,
            connection: {
                uri: 'mongodb://localhost:27017',
                database: 'bustransit'
            }
        }),
        BusTransit.AddBusTransit.setUp(/* ... */)
    ]
})
export class AppModule {}
```

### MongoDB with Authentication

```typescript
SagaPersistenceModule.forRoot({
    type: SagaPersistenceType.MongoDB,
    connection: {
        uri: 'mongodb://username:password@localhost:27017',
        database: 'bustransit',
        collectionName: 'saga_states'
    }
})
```

### MongoDB Replica Set

```typescript
SagaPersistenceModule.forRoot({
    type: SagaPersistenceType.MongoDB,
    connection: {
        uri: 'mongodb://host1:27017,host2:27017,host3:27017/?replicaSet=rs0',
        database: 'bustransit',
        poolSize: 20,
        ssl: true
    }
})
```

### MongoDB with Auto-Archiving

```typescript
SagaPersistenceModule.forRoot({
    type: SagaPersistenceType.MongoDB,
    connection: {
        uri: 'mongodb://localhost:27017',
        database: 'bustransit'
    },
    autoArchive: true,
    archiveTTL: 86400 * 30  // 30 days in seconds
})
```

### MongoDB Atlas

```typescript
SagaPersistenceModule.forRoot({
    type: SagaPersistenceType.MongoDB,
    connection: {
        uri: 'mongodb+srv://username:password@cluster0.mongodb.net',
        database: 'bustransit',
        ssl: true,
        poolSize: 10,
        connectionTimeout: 10000
    },
    autoArchive: true,
    archiveTTL: 86400 * 60  // 60 days
})
```

## PostgreSQL Configuration

### Basic PostgreSQL

```typescript
import { SagaPersistenceModule, SagaPersistenceType } from 'nestjs-bustransit';

@Module({
    imports: [
        SagaPersistenceModule.forRoot({
            type: SagaPersistenceType.PostgreSQL,
            connection: {
                host: 'localhost',
                port: 5432,
                username: 'postgres',
                password: 'password',
                database: 'bustransit'
            }
        }),
        BusTransit.AddBusTransit.setUp(/* ... */)
    ]
})
export class AppModule {}
```

### PostgreSQL with Custom Schema

```typescript
SagaPersistenceModule.forRoot({
    type: SagaPersistenceType.PostgreSQL,
    connection: {
        host: 'localhost',
        port: 5432,
        username: 'postgres',
        password: 'password',
        database: 'bustransit',
        schema: 'sagas',           // Custom schema
        tableName: 'order_sagas'   // Custom table name
    }
})
```

### PostgreSQL with SSL

```typescript
SagaPersistenceModule.forRoot({
    type: SagaPersistenceType.PostgreSQL,
    connection: {
        host: 'production-db.example.com',
        port: 5432,
        username: 'app_user',
        password: process.env.DB_PASSWORD,
        database: 'bustransit',
        ssl: true
    }
})
```

### PostgreSQL with Auto-Archiving

```typescript
SagaPersistenceModule.forRoot({
    type: SagaPersistenceType.PostgreSQL,
    connection: {
        host: 'localhost',
        port: 5432,
        username: 'postgres',
        password: 'password',
        database: 'bustransit'
    },
    autoArchive: true  // Soft delete with archivedAt timestamp
})
```

## Environment-Based Configuration

### Using ConfigService (Recommended)

```typescript
import { ConfigModule, ConfigService } from '@nestjs/config';
import { SagaPersistenceModule, SagaPersistenceType } from 'nestjs-bustransit';

@Module({
    imports: [
        ConfigModule.forRoot({
            isGlobal: true,
            envFilePath: ['.env.local', '.env']
        }),
        SagaPersistenceModule.forRootAsync({
            imports: [ConfigModule],
            useFactory: (config: ConfigService) => ({
                type: config.get('SAGA_PERSISTENCE_TYPE') as SagaPersistenceType,
                connection: {
                    // MongoDB
                    uri: config.get('MONGO_URI'),
                    database: config.get('MONGO_DATABASE'),

                    // PostgreSQL
                    host: config.get('DB_HOST'),
                    port: config.get('DB_PORT', 5432),
                    username: config.get('DB_USER'),
                    password: config.get('DB_PASSWORD'),
                    database: config.get('DB_NAME'),

                    // Common
                    ssl: config.get('DB_SSL', false)
                },
                autoArchive: config.get('SAGA_AUTO_ARCHIVE', true),
                archiveTTL: config.get('SAGA_ARCHIVE_TTL', 86400 * 30),
                retry: {
                    attempts: config.get('SAGA_RETRY_ATTEMPTS', 5),
                    delay: config.get('SAGA_RETRY_DELAY', 200),
                    exponentialBackoff: true
                }
            }),
            inject: [ConfigService]
        }),
        BusTransit.AddBusTransit.setUp(/* ... */)
    ]
})
export class AppModule {}
```

### Environment Variables (.env)

```bash
# Persistence type: InMemory | MongoDB | PostgreSQL
SAGA_PERSISTENCE_TYPE=PostgreSQL

# PostgreSQL
DB_HOST=localhost
DB_PORT=5432
DB_USER=postgres
DB_PASSWORD=password
DB_NAME=bustransit
DB_SSL=false

# MongoDB (alternative)
MONGO_URI=mongodb://localhost:27017
MONGO_DATABASE=bustransit

# Archiving
SAGA_AUTO_ARCHIVE=true
SAGA_ARCHIVE_TTL=2592000  # 30 days in seconds

# Retry configuration
SAGA_RETRY_ATTEMPTS=5
SAGA_RETRY_DELAY=200
```

### Environment-Specific Configuration

```typescript
// config/saga-persistence.config.ts
import { registerAs } from '@nestjs/config';
import { SagaPersistenceType } from 'nestjs-bustransit';

export default registerAs('sagaPersistence', () => ({
    type: process.env.NODE_ENV === 'production'
        ? SagaPersistenceType.PostgreSQL
        : SagaPersistenceType.InMemory,

    connection: {
        host: process.env.DB_HOST || 'localhost',
        port: parseInt(process.env.DB_PORT, 10) || 5432,
        username: process.env.DB_USER || 'postgres',
        password: process.env.DB_PASSWORD || 'password',
        database: process.env.DB_NAME || 'bustransit',
        ssl: process.env.NODE_ENV === 'production'
    },

    autoArchive: process.env.NODE_ENV === 'production',
    archiveTTL: 86400 * 30,

    retry: {
        attempts: process.env.NODE_ENV === 'production' ? 5 : 3,
        delay: 100,
        exponentialBackoff: true
    }
}));
```

```typescript
// app.module.ts
import sagaPersistenceConfig from './config/saga-persistence.config';

@Module({
    imports: [
        ConfigModule.forRoot({
            isGlobal: true,
            load: [sagaPersistenceConfig]
        }),
        SagaPersistenceModule.forRootAsync({
            useFactory: (config: ConfigService) => config.get('sagaPersistence'),
            inject: [ConfigService]
        })
    ]
})
export class AppModule {}
```

## Advanced Options

### Custom Serializer

```typescript
import { Injectable } from '@nestjs/common';
import { ISagaSerializer } from 'nestjs-bustransit';

@Injectable()
export class CustomSagaSerializer implements ISagaSerializer {
    serialize<TSaga>(saga: TSaga): any {
        // Custom serialization logic
        return {
            ...saga,
            _customField: 'metadata'
        };
    }

    deserialize<TSaga>(data: any, stateClass: new () => TSaga): TSaga {
        // Custom deserialization logic
        const instance = new stateClass();
        Object.assign(instance, data);
        return instance;
    }
}

// Module configuration
SagaPersistenceModule.forRoot({
    type: SagaPersistenceType.MongoDB,
    serializer: CustomSagaSerializer,
    connection: { /* ... */ }
})
```

### Retry Configuration

```typescript
SagaPersistenceModule.forRoot({
    type: SagaPersistenceType.PostgreSQL,
    connection: { /* ... */ },
    retry: {
        attempts: 5,              // Number of retry attempts
        delay: 200,              // Initial delay in milliseconds
        exponentialBackoff: true // 200ms → 400ms → 800ms → 1600ms → 3200ms
    }
})
```

### Disable Auto-Schema Creation

```typescript
SagaPersistenceModule.forRoot({
    type: SagaPersistenceType.PostgreSQL,
    connection: { /* ... */ },
    autoCreateSchema: false  // Manually manage schema
})
```

Manual schema creation (PostgreSQL):
```sql
CREATE TABLE saga_states (
    "correlationId" VARCHAR(255) PRIMARY KEY,
    "currentState" VARCHAR(100) NOT NULL,
    "sagaType" VARCHAR(100) NOT NULL,
    data JSONB NOT NULL,
    version INTEGER DEFAULT 0,
    "createdAt" TIMESTAMP DEFAULT NOW(),
    "updatedAt" TIMESTAMP DEFAULT NOW(),
    "archivedAt" TIMESTAMP NULL
);

CREATE INDEX idx_saga_current_state ON saga_states ("currentState");
CREATE INDEX idx_saga_type ON saga_states ("sagaType");
CREATE INDEX idx_saga_type_state ON saga_states ("sagaType", "currentState");
CREATE INDEX idx_saga_archived ON saga_states ("archivedAt") WHERE "archivedAt" IS NOT NULL;
```

## Custom Repository

### Implementing a Custom Repository

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { ISagaRepository, SagaStateMachineInstance } from 'nestjs-bustransit';

@Injectable()
export class RedisSagaRepository<TSaga extends SagaStateMachineInstance>
    implements ISagaRepository<TSaga> {

    private readonly logger = new Logger(RedisSagaRepository.name);

    constructor(private readonly redisClient: any) {}

    async findByCorrelationId(correlationId: string): Promise<TSaga | null> {
        const data = await this.redisClient.get(`saga:${correlationId}`);
        return data ? JSON.parse(data) : null;
    }

    async save(saga: TSaga): Promise<void> {
        await this.redisClient.set(
            `saga:${saga.CorrelationId}`,
            JSON.stringify(saga),
            'EX',
            86400  // 24 hour TTL
        );
    }

    async delete(correlationId: string): Promise<void> {
        await this.redisClient.del(`saga:${correlationId}`);
    }

    async archive(correlationId: string): Promise<void> {
        const saga = await this.findByCorrelationId(correlationId);
        if (saga) {
            await this.redisClient.set(
                `saga:archived:${correlationId}`,
                JSON.stringify(saga),
                'EX',
                2592000  // 30 day TTL
            );
            await this.delete(correlationId);
        }
    }

    async findByState(stateName: string): Promise<TSaga[]> {
        const keys = await this.redisClient.keys('saga:*');
        const sagas: TSaga[] = [];

        for (const key of keys) {
            const data = await this.redisClient.get(key);
            const saga = JSON.parse(data);
            if (saga.CurrentState === stateName) {
                sagas.push(saga);
            }
        }

        return sagas;
    }

    async find(query: any): Promise<TSaga[]> {
        // Custom query implementation
        return [];
    }

    async count(): Promise<number> {
        const keys = await this.redisClient.keys('saga:*');
        return keys.length;
    }
}
```

### Using Custom Repository

```typescript
@Module({
    imports: [
        SagaPersistenceModule.forRoot({
            type: SagaPersistenceType.Custom,
            customRepository: RedisSagaRepository
        })
    ],
    providers: [
        {
            provide: 'REDIS_CLIENT',
            useFactory: () => {
                // Initialize Redis client
                return require('redis').createClient();
            }
        }
    ]
})
export class AppModule {}
```

## Testing Configuration

### In-Memory for Tests

```typescript
// test/app.e2e-spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { SagaPersistenceModule, SagaPersistenceType } from 'nestjs-bustransit';

describe('AppController (e2e)', () => {
    let app: INestApplication;

    beforeEach(async () => {
        const moduleFixture: TestingModule = await Test.createTestingModule({
            imports: [
                SagaPersistenceModule.forRoot({
                    type: SagaPersistenceType.InMemory  // Fast for tests
                }),
                AppModule
            ]
        }).compile();

        app = moduleFixture.createNestApplication();
        await app.init();
    });

    // Your tests...
});
```

### Using Test Containers

```typescript
import { GenericContainer, StartedTestContainer } from 'testcontainers';

describe('Saga Persistence Integration Tests', () => {
    let mongoContainer: StartedTestContainer;
    let app: INestApplication;

    beforeAll(async () => {
        // Start MongoDB container
        mongoContainer = await new GenericContainer('mongo:7')
            .withExposedPorts(27017)
            .start();

        const moduleFixture = await Test.createTestingModule({
            imports: [
                SagaPersistenceModule.forRoot({
                    type: SagaPersistenceType.MongoDB,
                    connection: {
                        uri: `mongodb://${mongoContainer.getHost()}:${mongoContainer.getMappedPort(27017)}`,
                        database: 'test'
                    }
                }),
                AppModule
            ]
        }).compile();

        app = moduleFixture.createNestApplication();
        await app.init();
    });

    afterAll(async () => {
        await app.close();
        await mongoContainer.stop();
    });

    // Your tests...
});
```

## Troubleshooting

### Connection Errors

**Problem**: "Cannot connect to database"

**Solution**:
```typescript
SagaPersistenceModule.forRoot({
    type: SagaPersistenceType.PostgreSQL,
    connection: {
        host: 'localhost',
        port: 5432,
        username: 'postgres',
        password: 'password',
        database: 'bustransit',
        connectionTimeout: 10000  // Increase timeout
    },
    retry: {
        attempts: 5,  // Retry connection failures
        delay: 1000
    }
})
```

### Schema Creation Failures

**Problem**: "Table already exists" or "Collection already exists"

**Solution**:
```typescript
SagaPersistenceModule.forRoot({
    autoCreateSchema: false  // Disable auto-creation
})
```

### Performance Issues

**Problem**: Slow saga operations

**Solutions**:
1. Increase connection pool size
2. Add indexes to custom query fields
3. Use appropriate retry configuration
4. Consider caching for frequently accessed sagas

```typescript
SagaPersistenceModule.forRoot({
    connection: {
        poolSize: 20  // Increase pool size
    },
    retry: {
        attempts: 3,  // Reduce retries
        delay: 50     // Reduce delay
    }
})
```

## Best Practices

1. **Always use environment variables** for sensitive data (passwords, URIs)
2. **Use ConfigService** for environment-based configuration
3. **Enable auto-archiving** in production to prevent unbounded growth
4. **Set appropriate TTL** based on audit requirements
5. **Use connection pooling** for high-throughput applications
6. **Monitor saga counts** in production
7. **Test with real databases** before deploying to production
8. **Use retry configuration** appropriate for your workload

## Related Documentation

- [Saga Persistence Overview](./SAGA_PERSISTENCE.md)
- [Migration Guide](./SAGA_PERSISTENCE_MIGRATION.md)
- [Recovery Tools](./SAGA_RECOVERY_TOOLS.md) (coming soon)
