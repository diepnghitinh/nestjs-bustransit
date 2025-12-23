import { Injectable, Logger, Inject } from '@nestjs/common';
import { DataSource, Repository, IsNull } from 'typeorm';
import { ISagaRepository } from '../../interfaces/saga-repository.interface';
import { SagaStateMachineInstance } from '../../factories/saga.state-machine-instance';
import { ISagaSerializer } from '../../interfaces/saga-serializer.interface';
import { SagaPersistenceOptions } from '../../interfaces/saga-persistence-options.interface';
import { SAGA_PERSISTENCE_OPTIONS, SAGA_SERIALIZER, POSTGRESQL_CONNECTION } from '../../constants/saga-persistence.constants';
import { SagaStateEntity } from '../models/postgresql/saga-state.entity';

/**
 * PostgreSQL saga repository implementation using TypeORM
 * Supports optimistic locking, JSONB queries, and transaction support
 */
@Injectable()
export class PostgreSQLSagaRepository<TSaga extends SagaStateMachineInstance>
    implements ISagaRepository<TSaga> {

    private readonly logger = new Logger(PostgreSQLSagaRepository.name);
    private repository: Repository<SagaStateEntity>;
    private stateClass: new (...args: any[]) => TSaga;

    constructor(
        @Inject(SAGA_PERSISTENCE_OPTIONS) private readonly options: SagaPersistenceOptions,
        @Inject(SAGA_SERIALIZER) private readonly serializer: ISagaSerializer,
        @Inject(POSTGRESQL_CONNECTION) private readonly dataSource?: DataSource
    ) {
        if (!this.dataSource) {
            throw new Error('PostgreSQL DataSource not provided');
        }
        this.repository = this.dataSource.getRepository(SagaStateEntity);
        this.logger.log('PostgreSQL repository initialized');
    }

    /**
     * Find saga by correlation ID
     */
    async findByCorrelationId(correlationId: string): Promise<TSaga | null> {
        return this.withRetry(async () => {
            const entity = await this.repository.findOne({
                where: {
                    correlationId,
                    archivedAt: IsNull()  // Only return active sagas
                }
            });

            if (!entity) {
                this.logger.debug(`Saga not found: ${correlationId}`);
                return null;
            }

            this.logger.debug(`Found saga: ${correlationId}, State: ${entity.currentState}`);

            // Deserialize to saga instance
            const saga = this.serializer.deserialize<TSaga>(entity.data, this.stateClass);
            saga['version'] = entity.version;  // Preserve version for optimistic locking

            return saga;
        }, 'findByCorrelationId');
    }

    /**
     * Save or update saga state with optimistic locking
     */
    async save(saga: TSaga): Promise<void> {
        if (!saga.CorrelationId) {
            throw new Error('Saga must have a CorrelationId');
        }

        return this.withRetry(async () => {
            const serialized = this.serializer.serialize(saga);
            const currentVersion = saga['version'] || 0;
            const sagaType = saga.constructor.name;

            // Use raw query for upsert with optimistic locking
            // PostgreSQL-specific INSERT ... ON CONFLICT with version check
            const result = await this.repository.query(`
                INSERT INTO "saga_states" (
                    "correlationId",
                    "currentState",
                    "sagaType",
                    data,
                    version,
                    "createdAt",
                    "updatedAt"
                )
                VALUES ($1, $2, $3, $4, 1, NOW(), NOW())
                ON CONFLICT ("correlationId")
                DO UPDATE SET
                    "currentState" = $2,
                    "sagaType" = $3,
                    data = $4,
                    version = "saga_states".version + 1,
                    "updatedAt" = NOW()
                WHERE "saga_states".version = $5
                RETURNING version
            `, [
                saga.CorrelationId,
                saga.CurrentState,
                sagaType,
                serialized,
                currentVersion
            ]);

            if (!result || result.length === 0) {
                throw new Error(
                    `Optimistic locking failed for saga ${saga.CorrelationId}. ` +
                    `Version mismatch (expected: ${currentVersion})`
                );
            }

            // Update version on saga instance
            saga['version'] = result[0].version;

            this.logger.debug(
                `Saved saga: ${saga.CorrelationId}, State: ${saga.CurrentState}, Version: ${result[0].version}`
            );
        }, 'save');
    }

    /**
     * Delete saga by correlation ID (hard delete)
     */
    async delete(correlationId: string): Promise<void> {
        return this.withRetry(async () => {
            const result = await this.repository.delete({ correlationId });

            if (result.affected && result.affected > 0) {
                this.logger.debug(`Deleted saga: ${correlationId}`);
            } else {
                this.logger.debug(`Saga not found for deletion: ${correlationId}`);
            }
        }, 'delete');
    }

    /**
     * Archive saga (soft delete with timestamp)
     */
    async archive(correlationId: string): Promise<void> {
        return this.withRetry(async () => {
            const result = await this.repository.update(
                { correlationId, archivedAt: IsNull() },
                { archivedAt: new Date() }
            );

            if (result.affected && result.affected > 0) {
                this.logger.debug(`Archived saga: ${correlationId}`);
            } else {
                this.logger.debug(`Saga not found or already archived: ${correlationId}`);
            }
        }, 'archive');
    }

    /**
     * Find all sagas in a specific state
     */
    async findByState(stateName: string): Promise<TSaga[]> {
        return this.withRetry(async () => {
            const entities = await this.repository.find({
                where: {
                    currentState: stateName,
                    archivedAt: IsNull()
                }
            });

            this.logger.debug(`Found ${entities.length} sagas in state: ${stateName}`);

            return entities.map(entity => {
                const saga = this.serializer.deserialize<TSaga>(entity.data, this.stateClass);
                saga['version'] = entity.version;
                return saga;
            });
        }, 'findByState');
    }

    /**
     * Find sagas by custom criteria
     * Supports JSONB queries for PostgreSQL
     */
    async find(query: any): Promise<TSaga[]> {
        return this.withRetry(async () => {
            // Ensure we only return active sagas unless explicitly querying archived
            const finalQuery = {
                ...query,
                archivedAt: query.archivedAt !== undefined ? query.archivedAt : IsNull()
            };

            const entities = await this.repository.find({ where: finalQuery });

            this.logger.debug(`Found ${entities.length} sagas matching query`);

            return entities.map(entity => {
                const saga = this.serializer.deserialize<TSaga>(entity.data, this.stateClass);
                saga['version'] = entity.version;
                return saga;
            });
        }, 'find');
    }

    /**
     * Get total count of active sagas
     */
    async count(): Promise<number> {
        return this.withRetry(async () => {
            const count = await this.repository.count({
                where: { archivedAt: IsNull() }
            });

            this.logger.debug(`Active saga count: ${count}`);
            return count;
        }, 'count');
    }

    /**
     * Set saga state class for deserialization
     * Called by the state machine on initialization
     */
    setStateClass(stateClass: new (...args: any[]) => TSaga): void {
        this.stateClass = stateClass;
    }

    /**
     * Retry wrapper for database operations
     */
    private async withRetry<T>(
        operation: () => Promise<T>,
        context: string
    ): Promise<T> {
        const retryConfig = this.options.retry || {
            attempts: 3,
            delay: 100,
            exponentialBackoff: true
        };

        for (let attempt = 1; attempt <= retryConfig.attempts; attempt++) {
            try {
                return await operation();
            } catch (error) {
                const isLastAttempt = attempt === retryConfig.attempts;

                if (isLastAttempt) {
                    this.logger.error(
                        `PostgreSQL operation '${context}' failed after ${retryConfig.attempts} attempts`,
                        error
                    );
                    throw error;
                }

                const waitTime = retryConfig.exponentialBackoff
                    ? retryConfig.delay * Math.pow(2, attempt - 1)
                    : retryConfig.delay;

                this.logger.warn(
                    `PostgreSQL operation '${context}' failed (attempt ${attempt}/${retryConfig.attempts}), ` +
                    `retrying in ${waitTime}ms...`
                );

                await this.sleep(waitTime);
            }
        }

        throw new Error(`Unexpected retry loop exit for operation: ${context}`);
    }

    /**
     * Sleep utility for retry delays
     */
    private sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}
