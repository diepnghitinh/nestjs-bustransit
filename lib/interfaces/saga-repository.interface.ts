import { SagaStateMachineInstance } from '../factories/saga.state-machine-instance';

/**
 * Generic repository interface for saga state persistence
 * @template TSaga - Saga state type extending SagaStateMachineInstance
 */
export interface ISagaRepository<TSaga extends SagaStateMachineInstance> {
    /**
     * Find saga by correlation ID
     * @param correlationId - Unique saga instance identifier
     * @returns Saga instance or null if not found
     */
    findByCorrelationId(correlationId: string): Promise<TSaga | null>;

    /**
     * Save or update saga state
     * Upserts based on CorrelationId
     * @param saga - Saga instance to persist
     */
    save(saga: TSaga): Promise<void>;

    /**
     * Delete saga by correlation ID
     * Used when saga is finalized
     * @param correlationId - Unique saga instance identifier
     */
    delete(correlationId: string): Promise<void>;

    /**
     * Archive saga (soft delete)
     * Move to archive collection/table for audit purposes
     * @param correlationId - Unique saga instance identifier
     */
    archive(correlationId: string): Promise<void>;

    /**
     * Find all sagas in a specific state
     * Useful for recovery and monitoring
     * @param stateName - State name to filter by
     * @returns Array of sagas in the specified state
     */
    findByState(stateName: string): Promise<TSaga[]>;

    /**
     * Find sagas by custom criteria
     * @param query - Database-specific query object
     * @returns Array of matching sagas
     */
    find(query: any): Promise<TSaga[]>;

    /**
     * Get total count of active sagas
     * @returns Number of active sagas
     */
    count(): Promise<number>;
}
