import { Injectable, Logger } from '@nestjs/common';
import { ISagaRepository } from '../../interfaces/saga-repository.interface';
import { SagaStateMachineInstance } from '../../factories/saga.state-machine-instance';

/**
 * In-memory saga repository implementation
 * Default implementation with zero dependencies
 * Data is lost on application restart
 */
@Injectable()
export class InMemorySagaRepository<TSaga extends SagaStateMachineInstance>
    implements ISagaRepository<TSaga> {

    private readonly logger = new Logger(InMemorySagaRepository.name);
    private readonly store = new Map<string, TSaga>();
    private readonly archiveStore = new Map<string, TSaga>();

    /**
     * Find saga by correlation ID
     */
    async findByCorrelationId(correlationId: string): Promise<TSaga | null> {
        const saga = this.store.get(correlationId);

        if (saga) {
            this.logger.debug(`Found saga with CorrelationId: ${correlationId}`);
            // Return a deep copy to prevent external mutations
            return { ...saga } as TSaga;
        }

        this.logger.debug(`Saga not found with CorrelationId: ${correlationId}`);
        return null;
    }

    /**
     * Save or update saga state
     * Upserts based on CorrelationId
     */
    async save(saga: TSaga): Promise<void> {
        if (!saga.CorrelationId) {
            throw new Error('Saga must have a CorrelationId');
        }

        // Store a deep copy to prevent external mutations
        this.store.set(saga.CorrelationId, { ...saga } as TSaga);
        this.logger.debug(`Saved saga with CorrelationId: ${saga.CorrelationId}`);
    }

    /**
     * Delete saga by correlation ID
     */
    async delete(correlationId: string): Promise<void> {
        const deleted = this.store.delete(correlationId);

        if (deleted) {
            this.logger.debug(`Deleted saga with CorrelationId: ${correlationId}`);
        } else {
            this.logger.debug(`Saga not found for deletion: ${correlationId}`);
        }
    }

    /**
     * Archive saga (soft delete)
     * Moves saga from active store to archive store
     */
    async archive(correlationId: string): Promise<void> {
        const saga = this.store.get(correlationId);

        if (saga) {
            // Move to archive
            this.archiveStore.set(correlationId, { ...saga } as TSaga);
            this.store.delete(correlationId);
            this.logger.debug(`Archived saga with CorrelationId: ${correlationId}`);
        } else {
            this.logger.debug(`Saga not found for archiving: ${correlationId}`);
        }
    }

    /**
     * Find all sagas in a specific state
     */
    async findByState(stateName: string): Promise<TSaga[]> {
        const results: TSaga[] = [];

        for (const saga of this.store.values()) {
            if (saga.CurrentState === stateName) {
                results.push({ ...saga } as TSaga);
            }
        }

        this.logger.debug(`Found ${results.length} sagas in state: ${stateName}`);
        return results;
    }

    /**
     * Find sagas by custom criteria
     * Query is a filter function in this implementation
     */
    async find(query: (saga: TSaga) => boolean): Promise<TSaga[]> {
        const results: TSaga[] = [];

        for (const saga of this.store.values()) {
            if (query(saga)) {
                results.push({ ...saga } as TSaga);
            }
        }

        this.logger.debug(`Found ${results.length} sagas matching criteria`);
        return results;
    }

    /**
     * Get total count of active sagas
     */
    async count(): Promise<number> {
        const count = this.store.size;
        this.logger.debug(`Active saga count: ${count}`);
        return count;
    }

    /**
     * Get archived saga count (utility method)
     */
    async getArchivedCount(): Promise<number> {
        return this.archiveStore.size;
    }

    /**
     * Clear all sagas (utility method for testing)
     */
    async clear(): Promise<void> {
        this.store.clear();
        this.archiveStore.clear();
        this.logger.debug('Cleared all sagas');
    }

    /**
     * Get all active sagas (utility method)
     */
    async getAll(): Promise<TSaga[]> {
        return Array.from(this.store.values()).map(saga => ({ ...saga } as TSaga));
    }

    /**
     * Get all archived sagas (utility method)
     */
    async getAllArchived(): Promise<TSaga[]> {
        return Array.from(this.archiveStore.values()).map(saga => ({ ...saga } as TSaga));
    }
}
