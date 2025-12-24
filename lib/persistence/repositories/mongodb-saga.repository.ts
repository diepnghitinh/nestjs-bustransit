import { Injectable, Logger, Inject } from '@nestjs/common';
import { Model, Connection } from 'mongoose';
import { ISagaRepository } from '../../interfaces/saga-repository.interface';
import { SagaStateMachineInstance } from '../../factories/saga.state-machine-instance';
import { ISagaSerializer } from '../../interfaces/saga-serializer.interface';
import { SagaPersistenceOptions } from '../../interfaces/saga-persistence-options.interface';
import { SAGA_PERSISTENCE_OPTIONS, SAGA_SERIALIZER, MONGODB_CONNECTION } from '../../constants/saga-persistence.constants';
import { SagaStateSchema, SagaStateDocument } from '../models/mongodb/saga-state.schema';

/**
 * MongoDB saga repository implementation using Mongoose
 * Supports optimistic locking, TTL for archived sagas, and retry logic
 */
@Injectable()
export class MongoDBSagaRepository<TSaga extends SagaStateMachineInstance>
    implements ISagaRepository<TSaga> {

    private readonly logger = new Logger(MongoDBSagaRepository.name);
    private model: Model<SagaStateDocument>;
    private stateClass: new (...args: any[]) => TSaga;

    constructor(
        @Inject(SAGA_PERSISTENCE_OPTIONS) private readonly options: SagaPersistenceOptions,
        @Inject(SAGA_SERIALIZER) private readonly serializer: ISagaSerializer,
        @Inject(MONGODB_CONNECTION) private readonly connection?: Connection
    ) {
        this.initializeModel();
    }

    /**
     * Initialize Mongoose model with TTL index if configured
     */
    private initializeModel(): void {
        const collectionName = this.options.connection?.collectionName || 'saga_states';

        // Create TTL index if archiveTTL is configured
        if (this.options.archiveTTL) {
            SagaStateSchema.index(
                { archivedAt: 1 },
                {
                    expireAfterSeconds: this.options.archiveTTL,
                    partialFilterExpression: { archivedAt: { $ne: null } }
                }
            );
            this.logger.log(`TTL index configured: ${this.options.archiveTTL} seconds`);
        }

        // Get or create model
        if (this.connection) {
            this.model = this.connection.model<SagaStateDocument>(collectionName, SagaStateSchema);
        } else {
            const mongoose = require('mongoose') as {
                model<T>(name: string, schema: any): Model<T>
            };
            this.model = mongoose.model<SagaStateDocument>(collectionName, SagaStateSchema);
        }

        this.logger.log(`MongoDB model initialized: ${collectionName}`);
    }

    /**
     * Find saga by correlation ID
     */
    async findByCorrelationId(correlationId: string): Promise<TSaga | null> {
        return this.withRetry(async () => {
            const doc = await this.model.findOne({
                correlationId,
                archivedAt: null  // Only return active sagas
            }).exec();

            if (!doc) {
                this.logger.debug(`Saga not found: ${correlationId}`);
                return null;
            }

            this.logger.debug(`Found saga: ${correlationId}, State: ${doc.currentState}`);

            // Deserialize to saga instance
            const saga = this.serializer.deserialize<TSaga>(doc.data, this.stateClass);
            saga['version'] = doc.version;  // Preserve version for optimistic locking

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

            // Upsert with optimistic locking
            const result = await this.model.findOneAndUpdate(
                {
                    correlationId: saga.CorrelationId,
                    $or: [
                        { version: currentVersion },  // Match version for existing docs
                        { _id: { $exists: false } }   // Allow insert for new docs
                    ]
                },
                {
                    $set: {
                        currentState: saga.CurrentState,
                        sagaType: sagaType,
                        data: serialized,
                        updatedAt: new Date()
                    },
                    $inc: { version: 1 },
                    $setOnInsert: {
                        correlationId: saga.CorrelationId,
                        createdAt: new Date()
                    }
                },
                {
                    upsert: true,
                    new: true,
                    runValidators: true
                }
            ).exec();

            if (!result) {
                throw new Error(
                    `Optimistic locking failed for saga ${saga.CorrelationId}. ` +
                    `Version mismatch (expected: ${currentVersion})`
                );
            }

            // Update version on saga instance
            saga['version'] = result.version;

            this.logger.debug(
                `Saved saga: ${saga.CorrelationId}, State: ${saga.CurrentState}, Version: ${result.version}`
            );
        }, 'save');
    }

    /**
     * Delete saga by correlation ID (hard delete)
     */
    async delete(correlationId: string): Promise<void> {
        return this.withRetry(async () => {
            const result = await this.model.deleteOne({ correlationId }).exec();

            if (result.deletedCount > 0) {
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
            const result = await this.model.updateOne(
                { correlationId, archivedAt: null },
                { $set: { archivedAt: new Date() } }
            ).exec();

            if (result.modifiedCount > 0) {
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
            const docs = await this.model.find({
                currentState: stateName,
                archivedAt: null
            }).exec();

            this.logger.debug(`Found ${docs.length} sagas in state: ${stateName}`);

            return docs.map(doc => {
                const saga = this.serializer.deserialize<TSaga>(doc.data, this.stateClass);
                saga['version'] = doc.version;
                return saga;
            });
        }, 'findByState');
    }

    /**
     * Find sagas by custom MongoDB query
     */
    async find(query: any): Promise<TSaga[]> {
        return this.withRetry(async () => {
            // Ensure we only return active sagas unless explicitly querying archived
            const finalQuery = {
                ...query,
                archivedAt: query.archivedAt !== undefined ? query.archivedAt : null
            };

            const docs = await this.model.find(finalQuery).exec();

            this.logger.debug(`Found ${docs.length} sagas matching query`);

            return docs.map(doc => {
                const saga = this.serializer.deserialize<TSaga>(doc.data, this.stateClass);
                saga['version'] = doc.version;
                return saga;
            });
        }, 'find');
    }

    /**
     * Get total count of active sagas
     */
    async count(): Promise<number> {
        return this.withRetry(async () => {
            const count = await this.model.countDocuments({ archivedAt: null }).exec();
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
                        `MongoDB operation '${context}' failed after ${retryConfig.attempts} attempts`,
                        error
                    );
                    throw error;
                }

                const waitTime = retryConfig.exponentialBackoff
                    ? retryConfig.delay * Math.pow(2, attempt - 1)
                    : retryConfig.delay;

                this.logger.warn(
                    `MongoDB operation '${context}' failed (attempt ${attempt}/${retryConfig.attempts}), ` +
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
