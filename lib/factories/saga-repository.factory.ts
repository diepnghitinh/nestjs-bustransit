import { Logger } from '@nestjs/common';
import { ISagaRepository } from '../interfaces/saga-repository.interface';
import { SagaPersistenceType } from '../constants/saga-persistence.constants';
import { SagaPersistenceOptions } from '../interfaces/saga-persistence-options.interface';
import { ISagaSerializer } from '../interfaces/saga-serializer.interface';
import { SagaStateMachineInstance } from './saga.state-machine-instance';
import { InMemorySagaRepository } from '../persistence/repositories/in-memory-saga.repository';

/**
 * Factory to create saga repository instances based on persistence type
 */
export class SagaRepositoryFactory {
    private static readonly logger = new Logger(SagaRepositoryFactory.name);

    /**
     * Create repository instance based on configuration
     */
    static create<TSaga extends SagaStateMachineInstance>(
        options: SagaPersistenceOptions,
        serializer: ISagaSerializer,
        mongoConnection?: any,
        postgresConnection?: any
    ): ISagaRepository<TSaga> {
        this.logger.log(`[RepositoryFactory] Creating saga repository of type: ${options.type}`);

        // Custom repository takes precedence
        if (options.customRepository) {
            this.logger.log('[RepositoryFactory] Creating custom saga repository');
            return new options.customRepository();
        }

        // Factory based on type
        switch (options.type) {
            case SagaPersistenceType.InMemory:
                this.logger.log('[RepositoryFactory] Creating in-memory saga repository');
                return new InMemorySagaRepository<TSaga>();

            case SagaPersistenceType.MongoDB:
                this.logger.log('[RepositoryFactory] Creating MongoDB saga repository');
                this.logger.log(`[RepositoryFactory] MongoDB connection available: ${!!mongoConnection}`);
                if (!mongoConnection) {
                    this.logger.error('[RepositoryFactory] MongoDB connection not available');
                    throw new Error(
                        'MongoDB persistence requires mongoose to be installed. ' +
                        'Run: npm install mongoose'
                    );
                }
                // Import dynamically to avoid loading if not needed
                const { MongoDBSagaRepository }: {
                    MongoDBSagaRepository: new (options: any, serializer: any, mongoConnection: any) => ISagaRepository<TSaga>
                } = require('../persistence/repositories/mongodb-saga.repository');
                this.logger.log('[RepositoryFactory] MongoDB repository created successfully');
                return new MongoDBSagaRepository(options, serializer, mongoConnection);

            case SagaPersistenceType.PostgreSQL:
                this.logger.log('[RepositoryFactory] Creating PostgreSQL saga repository');
                this.logger.log(`[RepositoryFactory] PostgreSQL connection available: ${!!postgresConnection}`);
                if (!postgresConnection) {
                    this.logger.error('[RepositoryFactory] PostgreSQL connection not available');
                    throw new Error(
                        'PostgreSQL persistence requires @nestjs/typeorm, typeorm, and pg to be installed. ' +
                        'Run: npm install @nestjs/typeorm typeorm pg'
                    );
                }
                // Import dynamically to avoid loading if not needed
                const { PostgreSQLSagaRepository }: {
                    PostgreSQLSagaRepository: new (options: any, serializer: any, postgresConnection: any) => ISagaRepository<TSaga>
                } = require('../persistence/repositories/postgresql-saga.repository');
                this.logger.log('[RepositoryFactory] PostgreSQL repository created successfully');
                return new PostgreSQLSagaRepository(options, serializer, postgresConnection);

            default:
                throw new Error(`Unsupported persistence type: ${options.type}`);
        }
    }
}
