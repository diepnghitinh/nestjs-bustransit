import { Type } from '@nestjs/common';
import { SagaPersistenceType } from '../constants/saga-persistence.constants';
import { ISagaRepository } from './saga-repository.interface';
import { ISagaSerializer } from './saga-serializer.interface';

/**
 * Connection configuration for database persistence
 */
export interface SagaPersistenceConnectionOptions {
    // MongoDB options
    uri?: string;
    database?: string;
    collectionName?: string;

    // PostgreSQL options
    host?: string;
    port?: number;
    username?: string;
    password?: string;
    schema?: string;
    tableName?: string;

    // Common options
    poolSize?: number;
    ssl?: boolean;
    connectionTimeout?: number;
}

/**
 * Retry configuration for persistence operations
 */
export interface SagaPersistenceRetryOptions {
    /**
     * Number of retry attempts
     * @default 3
     */
    attempts?: number;

    /**
     * Initial delay between retries in milliseconds
     * @default 100
     */
    delay?: number;

    /**
     * Use exponential backoff for retries
     * @default true
     */
    exponentialBackoff?: boolean;
}

/**
 * Main persistence module options
 */
export interface SagaPersistenceOptions {
    /**
     * Type of persistence to use
     * @default SagaPersistenceType.InMemory
     */
    type: SagaPersistenceType;

    /**
     * Connection configuration (type-specific)
     */
    connection?: SagaPersistenceConnectionOptions;

    /**
     * Custom repository instance
     * Overrides type-based factory
     */
    customRepository?: Type<ISagaRepository<any>>;

    /**
     * Enable automatic archiving on finalization
     * @default false
     */
    autoArchive?: boolean;

    /**
     * TTL for archived sagas (in seconds)
     * Only applicable for MongoDB (uses TTL index)
     * For PostgreSQL, cleanup service will use this value
     */
    archiveTTL?: number;

    /**
     * Custom serializer
     */
    serializer?: Type<ISagaSerializer>;

    /**
     * Retry configuration for persistence operations
     */
    retry?: SagaPersistenceRetryOptions;

    /**
     * Automatically create schemas/collections on startup
     * @default true
     */
    autoCreateSchema?: boolean;
}

/**
 * Async configuration options for forRootAsync()
 */
export interface SagaPersistenceAsyncOptions {
    /**
     * Factory function to create options
     */
    useFactory?: (...args: any[]) => Promise<SagaPersistenceOptions> | SagaPersistenceOptions;

    /**
     * Dependencies to inject into the factory
     */
    inject?: any[];

    /**
     * Imports needed for the factory (e.g., ConfigModule)
     */
    imports?: any[];
}
