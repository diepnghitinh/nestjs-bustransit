# Saga Persistence Migration Guide

## Overview

This guide helps you migrate saga state machines from in-memory storage to persistent database storage (MongoDB or PostgreSQL).

## Table of Contents

- [Before You Begin](#before-you-begin)
- [Zero-Downtime Migration](#zero-downtime-migration)
- [MongoDB Migration](#mongodb-migration)
- [PostgreSQL Migration](#postgresql-migration)
- [Rollback Strategy](#rollback-strategy)
- [Testing the Migration](#testing-the-migration)
- [Post-Migration Cleanup](#post-migration-cleanup)

## Before You Begin

### Prerequisites

✅ Understand your current saga volume and throughput
✅ Choose target database (MongoDB or PostgreSQL)
✅ Have database credentials and connection details
✅ Plan maintenance window (if required)
✅ Backup current saga definitions and code
✅ Test migration in staging environment first

### Compatibility Check

The persistence module is **backward compatible**. Your existing sagas will continue to work without any code changes. Simply add the persistence module to enable database storage.

**What changes:**
- Saga state is now persisted to database
- Sagas survive application restarts
- Better visibility into saga state

**What doesn't change:**
- Saga state machine definitions
- Event handlers and workflows
- Message routing and correlation
- Compensation logic

## Zero-Downtime Migration

### Step 1: Install Dependencies

Choose your target database and install dependencies:

**MongoDB:**
```bash
npm install mongoose
```

**PostgreSQL:**
```bash
npm install @nestjs/typeorm typeorm pg
```

### Step 2: Add Configuration (Not Yet Active)

Add persistence configuration to your module, but don't import it yet:

```typescript
// persistence.config.ts
import { SagaPersistenceType } from 'nestjs-bustransit';

export const persistenceConfig = {
    type: SagaPersistenceType.MongoDB,  // or PostgreSQL
    connection: {
        uri: process.env.MONGO_URI || 'mongodb://localhost:27017',
        database: 'bustransit'
    },
    autoArchive: true,
    archiveTTL: 86400 * 30
};
```

### Step 3: Test Configuration (Staging/Dev)

Deploy to staging with persistence enabled:

```typescript
// app.module.ts (STAGING ONLY)
@Module({
    imports: [
        SagaPersistenceModule.forRoot(persistenceConfig),  // Add this
        BusTransit.AddBusTransit.setUp(/* ... */)
    ]
})
export class AppModule {}
```

Verify:
1. Application starts without errors
2. Database connection succeeds
3. Schema/collections created automatically
4. New sagas are persisted
5. Saga state loads correctly
6. Saga finalization works (archive/delete)

### Step 4: Deploy to Production

Once validated in staging:

1. **Deploy application with persistence enabled**
   ```typescript
   @Module({
       imports: [
           SagaPersistenceModule.forRoot(persistenceConfig),
           BusTransit.AddBusTransit.setUp(/* ... */)
       ]
   })
   export class AppModule {}
   ```

2. **Monitor logs for errors**
   ```
   [SG] Saga state machine initialized with persistent repository
   [SG] MongoDB model initialized: saga_states
   ```

3. **Verify database writes**
   ```bash
   # MongoDB
   mongo bustransit --eval "db.saga_states.count()"

   # PostgreSQL
   psql -d bustransit -c "SELECT COUNT(*) FROM saga_states;"
   ```

### Step 5: Monitor Performance

Watch for:
- Increased database connections
- Saga operation latency
- Database query performance
- Error rates

Adjust configuration as needed:
```typescript
SagaPersistenceModule.forRoot({
    connection: {
        poolSize: 20  // Increase if needed
    },
    retry: {
        attempts: 5,
        delay: 200
    }
})
```

## MongoDB Migration

### Complete MongoDB Setup

1. **Install MongoDB driver**
   ```bash
   npm install mongoose
   ```

2. **Configure connection**
   ```typescript
   import { SagaPersistenceModule, SagaPersistenceType } from 'nestjs-bustransit';

   @Module({
       imports: [
           SagaPersistenceModule.forRootAsync({
               useFactory: (config: ConfigService) => ({
                   type: SagaPersistenceType.MongoDB,
                   connection: {
                       uri: config.get('MONGO_URI'),
                       database: config.get('MONGO_DATABASE', 'bustransit'),
                       collectionName: 'saga_states',
                       poolSize: 10,
                       ssl: config.get('MONGO_SSL', false)
                   },
                   autoArchive: true,
                   archiveTTL: 86400 * 30,  // 30 days
                   retry: {
                       attempts: 5,
                       delay: 200,
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

3. **Environment variables**
   ```bash
   MONGO_URI=mongodb://localhost:27017
   MONGO_DATABASE=bustransit
   MONGO_SSL=false
   ```

4. **Verify indexes created**
   ```javascript
   use bustransit
   db.saga_states.getIndexes()

   // Expected output:
   [
       { v: 2, key: { _id: 1 }, name: "_id_" },
       { v: 2, key: { correlationId: 1 }, name: "correlationId_1", unique: true },
       { v: 2, key: { currentState: 1 }, name: "currentState_1" },
       { v: 2, key: { sagaType: 1 }, name: "sagaType_1" },
       { v: 2, key: { sagaType: 1, currentState: 1 }, name: "sagaType_1_currentState_1" }
   ]
   ```

### MongoDB Best Practices

1. **Use Replica Sets in Production**
   ```typescript
   connection: {
       uri: 'mongodb://host1:27017,host2:27017,host3:27017/?replicaSet=rs0'
   }
   ```

2. **Enable Write Concern**
   ```typescript
   connection: {
       uri: 'mongodb://localhost:27017/?w=majority'
   }
   ```

3. **Monitor Collection Size**
   ```javascript
   db.saga_states.stats()
   ```

4. **Setup Backup Strategy**
   ```bash
   mongodump --db bustransit --collection saga_states --out /backup
   ```

## PostgreSQL Migration

### Complete PostgreSQL Setup

1. **Install TypeORM dependencies**
   ```bash
   npm install @nestjs/typeorm typeorm pg
   ```

2. **Configure connection**
   ```typescript
   import { SagaPersistenceModule, SagaPersistenceType } from 'nestjs-bustransit';

   @Module({
       imports: [
           SagaPersistenceModule.forRootAsync({
               useFactory: (config: ConfigService) => ({
                   type: SagaPersistenceType.PostgreSQL,
                   connection: {
                       host: config.get('DB_HOST'),
                       port: config.get('DB_PORT', 5432),
                       username: config.get('DB_USER'),
                       password: config.get('DB_PASSWORD'),
                       database: config.get('DB_NAME'),
                       schema: config.get('DB_SCHEMA', 'public'),
                       tableName: 'saga_states',
                       ssl: config.get('DB_SSL', false)
                   },
                   autoArchive: true,
                   autoCreateSchema: true,
                   retry: {
                       attempts: 5,
                       delay: 200,
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

3. **Environment variables**
   ```bash
   DB_HOST=localhost
   DB_PORT=5432
   DB_USER=postgres
   DB_PASSWORD=password
   DB_NAME=bustransit
   DB_SCHEMA=public
   DB_SSL=false
   ```

4. **Verify table created**
   ```sql
   \d saga_states

   -- Expected output:
   Table "public.saga_states"
   Column         | Type                     | Nullable
   ---------------+--------------------------+----------
   correlationId  | character varying(255)   | not null
   currentState   | character varying(100)   | not null
   sagaType       | character varying(100)   | not null
   data           | jsonb                    | not null
   version        | integer                  | not null (default 0)
   createdAt      | timestamp                | not null
   updatedAt      | timestamp                | not null
   archivedAt     | timestamp                |

   Indexes:
       "saga_states_pkey" PRIMARY KEY, btree (correlationId)
       "idx_saga_current_state" btree (currentState)
       "idx_saga_type" btree (sagaType)
       "idx_saga_type_state" btree (sagaType, currentState)
       "idx_saga_archived" btree (archivedAt) WHERE archivedAt IS NOT NULL
   ```

### PostgreSQL Best Practices

1. **Use Connection Pooling**
   ```typescript
   connection: {
       poolSize: 20
   }
   ```

2. **Setup Automated Archival Cleanup**
   ```sql
   -- Option 1: Manual cleanup script
   DELETE FROM saga_states
   WHERE "archivedAt" IS NOT NULL
     AND "archivedAt" < NOW() - INTERVAL '30 days';

   -- Option 2: pg_cron extension
   CREATE EXTENSION IF NOT EXISTS pg_cron;

   SELECT cron.schedule(
       'cleanup-archived-sagas',
       '0 2 * * *',  -- Daily at 2 AM
       $$DELETE FROM saga_states
         WHERE "archivedAt" IS NOT NULL
           AND "archivedAt" < NOW() - INTERVAL '30 days'$$
   );
   ```

3. **Add GIN Index for JSONB Queries** (if querying saga data)
   ```sql
   CREATE INDEX idx_saga_data_gin ON saga_states USING GIN (data);
   ```

4. **Monitor Table Size**
   ```sql
   SELECT
       pg_size_pretty(pg_total_relation_size('saga_states')) as total_size,
       pg_size_pretty(pg_relation_size('saga_states')) as table_size,
       pg_size_pretty(pg_indexes_size('saga_states')) as indexes_size;
   ```

5. **Setup Backup Strategy**
   ```bash
   pg_dump -t saga_states bustransit > saga_states_backup.sql
   ```

## Rollback Strategy

### Quick Rollback (Remove Persistence)

If issues arise, quickly rollback to in-memory:

1. **Remove persistence module import**
   ```typescript
   @Module({
       imports: [
           // Comment out or remove this line
           // SagaPersistenceModule.forRoot(persistenceConfig),
           BusTransit.AddBusTransit.setUp(/* ... */)
       ]
   })
   export class AppModule {}
   ```

2. **Restart application**
   - Sagas will revert to in-memory storage
   - Existing saga data in database remains intact
   - No data loss (sagas are persisted in database)

3. **Monitor application**
   - Verify sagas process correctly
   - Check error logs

### Graceful Rollback (Keep Data)

To rollback while preserving saga data:

1. **Export saga data**
   ```bash
   # MongoDB
   mongoexport --db bustransit --collection saga_states --out sagas_backup.json

   # PostgreSQL
   pg_dump -t saga_states bustransit > sagas_backup.sql
   ```

2. **Remove persistence module**

3. **Optionally import data later**
   ```bash
   # MongoDB
   mongoimport --db bustransit --collection saga_states --file sagas_backup.json

   # PostgreSQL
   psql bustransit < sagas_backup.sql
   ```

## Testing the Migration

### Pre-Migration Test Checklist

- [ ] Create test saga in staging
- [ ] Verify saga state persists after restart
- [ ] Test saga transitions and state updates
- [ ] Verify saga finalization (archive/delete)
- [ ] Test optimistic locking (concurrent updates)
- [ ] Monitor database performance
- [ ] Test error scenarios (connection loss, retry)
- [ ] Verify logging output

### Migration Validation Script

```typescript
// scripts/validate-migration.ts
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ISagaRepository } from 'nestjs-bustransit';

async function validateMigration() {
    const app = await NestFactory.createApplicationContext(AppModule);
    const repository = app.get('SAGA_REPOSITORY') as ISagaRepository<any>;

    try {
        // Test 1: Count sagas
        const count = await repository.count();
        console.log(`✓ Saga count: ${count}`);

        // Test 2: Find by state
        const pending = await repository.findByState('INITIALLY');
        console.log(`✓ Pending sagas: ${pending.length}`);

        // Test 3: Save and load
        const testSaga = {
            CorrelationId: 'test-migration-' + Date.now(),
            CurrentState: 'INITIALLY'
        };
        await repository.save(testSaga as any);
        console.log(`✓ Save test passed`);

        const loaded = await repository.findByCorrelationId(testSaga.CorrelationId);
        if (loaded) {
            console.log(`✓ Load test passed`);
        }

        // Cleanup
        await repository.delete(testSaga.CorrelationId);
        console.log(`✓ Delete test passed`);

        console.log('\n✓ All validation tests passed!');
    } catch (error) {
        console.error('✗ Validation failed:', error);
        process.exit(1);
    } finally {
        await app.close();
    }
}

validateMigration();
```

Run validation:
```bash
npx ts-node scripts/validate-migration.ts
```

## Post-Migration Cleanup

### Monitor Saga Growth

```typescript
// Add health check
@Controller('health')
export class HealthController {
    constructor(
        @Inject(SAGA_REPOSITORY) private repository: ISagaRepository<any>
    ) {}

    @Get('sagas')
    async checkSagas() {
        const count = await this.repository.count();
        return {
            status: count < 10000 ? 'healthy' : 'warning',
            activeSagas: count
        };
    }
}
```

### Setup Monitoring

```typescript
// Periodic saga count logging
@Injectable()
export class SagaMonitorService {
    constructor(
        @Inject(SAGA_REPOSITORY) private repository: ISagaRepository<any>
    ) {}

    @Cron('0 */6 * * *')  // Every 6 hours
    async logSagaStats() {
        const count = await this.repository.count();
        Logger.log(`Active sagas: ${count}`, 'SagaMonitor');
    }
}
```

### Database Maintenance

**MongoDB:**
```javascript
// Compact collection
db.saga_states.compact()

// Rebuild indexes
db.saga_states.reIndex()

// Check fragmentation
db.saga_states.stats()
```

**PostgreSQL:**
```sql
-- Vacuum table
VACUUM ANALYZE saga_states;

-- Reindex
REINDEX TABLE saga_states;

-- Check bloat
SELECT
    schemaname,
    tablename,
    pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) AS size
FROM pg_tables
WHERE tablename = 'saga_states';
```

## Troubleshooting

### Issue: Sagas Not Persisting

**Symptoms:** Sagas lost after restart

**Solution:**
1. Verify `SagaPersistenceModule` imported before `BusTransit`
2. Check database connection logs
3. Verify saga has `CorrelationId` set

```typescript
// Correct order
@Module({
    imports: [
        SagaPersistenceModule.forRoot(/* ... */),  // First
        BusTransit.AddBusTransit.setUp(/* ... */)  // Second
    ]
})
```

### Issue: High Database Load

**Symptoms:** Slow saga processing, high CPU on database

**Solution:**
1. Increase connection pool size
2. Add indexes for custom queries
3. Enable auto-archiving to reduce data size

```typescript
SagaPersistenceModule.forRoot({
    connection: {
        poolSize: 30  // Increase
    },
    autoArchive: true,
    archiveTTL: 86400 * 7  // Shorter retention
})
```

### Issue: Optimistic Locking Errors

**Symptoms:** Frequent "Optimistic locking failed" errors

**Solution:** This is expected with duplicate consumers. Check queue configuration:

```typescript
// Ensure only one consumer per saga type
bus.AddSagaStateMachine(OrderStateMachine, OrderState)
    .ConfigureConsumer(/* configure single consumer */);
```

## Next Steps

After successful migration:

1. ✅ **Enable Monitoring** - Track saga counts and performance
2. ✅ **Setup Backup Strategy** - Regular database backups
3. ✅ **Configure Archiving** - Prevent unbounded growth
4. ✅ **Add Health Checks** - Monitor database connection
5. ✅ **Document Configuration** - Update team documentation
6. ✅ **Setup Alerts** - Alert on high saga counts or errors

## Related Documentation

- [Saga Persistence Overview](./SAGA_PERSISTENCE.md)
- [Configuration Guide](./SAGA_PERSISTENCE_CONFIGURATION.md)
- [Recovery Tools](./SAGA_RECOVERY_TOOLS.md) (coming soon)
