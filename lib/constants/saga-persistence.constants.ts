/**
 * Injection tokens for saga persistence module
 */
export const SAGA_REPOSITORY = 'SAGA_REPOSITORY';
export const SAGA_PERSISTENCE_OPTIONS = 'SAGA_PERSISTENCE_OPTIONS';
export const SAGA_SERIALIZER = 'SAGA_SERIALIZER';
export const MONGODB_CONNECTION = 'MONGODB_CONNECTION';
export const POSTGRESQL_CONNECTION = 'POSTGRESQL_CONNECTION';

/**
 * Persistence type enum
 */
export enum SagaPersistenceType {
    InMemory = 'InMemory',
    MongoDB = 'MongoDB',
    PostgreSQL = 'PostgreSQL',
    Custom = 'Custom'
}
