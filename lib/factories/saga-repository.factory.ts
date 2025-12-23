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
        // Custom repository takes precedence
        if (options.customRepository) {
            this.logger.log('Creating custom saga repository');
            return new options.customRepository();
        }

        // Factory based on type
        switch (options.type) {
            case SagaPersistenceType.InMemory:
                this.logger.log('Creating in-memory saga repository');
                return new InMemorySagaRepository<TSaga>();

            case SagaPersistenceType.MongoDB:
                this.logger.log('Creating MongoDB saga repository');
                // MongoDB repository will be implemented in Phase 2
                // For now, throw error to guide users
                if (!mongoConnection) {
                    throw new Error(
                        'MongoDB persistence requires mongoose to be installed. ' +
                        'Run: npm install mongoose'
                    );
                }
                // Import dynamically to avoid loading if not needed
                const { MongoDBSagaRepository }: {
                    MongoDBSagaRepository: new (options: any, serializer: any, mongoConnection: any) => ISagaRepository<TSaga>
                } = require('../persistence/repositories/mongodb-saga.repository');
                return new MongoDBSagaRepository(options, serializer, mongoConnection);

            case SagaPersistenceType.PostgreSQL:
                this.logger.log('Creating PostgreSQL saga repository');
                // PostgreSQL repository will be implemented in Phase 3
                // For now, throw error to guide users
                if (!postgresConnection) {
                    throw new Error(
                        'PostgreSQL persistence requires @nestjs/typeorm, typeorm, and pg to be installed. ' +
                        'Run: npm install @nestjs/typeorm typeorm pg'
                    );
                }
                // Import dynamically to avoid loading if not needed
                const { PostgreSQLSagaRepository }: {
                    PostgreSQLSagaRepository: new (options: any, serializer: any, postgresConnection: any) => ISagaRepository<TSaga>
                } = require('../persistence/repositories/postgresql-saga.repository');
                return new PostgreSQLSagaRepository(options, serializer, postgresConnection);

            default:
                throw new Error(`Unsupported persistence type: ${options.type}`);
        }
    }
}
