/**
 * Saga Persistence Module
 * Provides database persistence for saga state machines
 */

import { DynamicModule, Module, Provider, Global } from '@nestjs/common';
import { Connection } from 'mongoose';
import { DataSource } from 'typeorm';
import {
    SAGA_REPOSITORY,
    SAGA_PERSISTENCE_OPTIONS,
    SAGA_SERIALIZER,
    MONGODB_CONNECTION,
    POSTGRESQL_CONNECTION,
    SagaPersistenceType
} from '../constants/saga-persistence.constants';
import {
    SagaPersistenceOptions,
    SagaPersistenceAsyncOptions
} from '../interfaces/saga-persistence-options.interface';
import { JsonSagaSerializer } from './serializers/json-saga.serializer';
import { SagaRepositoryFactory } from '../factories/saga-repository.factory';

@Module({})
export class SagaPersistenceModule {
    /**
     * Configure saga persistence module with options
     *
     * @example In-Memory (default)
     * ```typescript
     * @Module({
     *   imports: [
     *     SagaPersistenceModule.forRoot({
     *       type: SagaPersistenceType.InMemory
     *     })
     *   ]
     * })
     * export class AppModule {}
     * ```
     *
     * @example MongoDB
     * ```typescript
     * @Module({
     *   imports: [
     *     SagaPersistenceModule.forRoot({
     *       type: SagaPersistenceType.MongoDB,
     *       connection: {
     *         uri: 'mongodb://localhost:27017',
     *         database: 'bustransit',
     *         collectionName: 'saga_states'
     *       },
     *       autoArchive: true,
     *       archiveTTL: 86400 * 30 // 30 days
     *     })
     *   ]
     * })
     * export class AppModule {}
     * ```
     *
     * @example PostgreSQL
     * ```typescript
     * @Module({
     *   imports: [
     *     SagaPersistenceModule.forRoot({
     *       type: SagaPersistenceType.PostgreSQL,
     *       connection: {
     *         host: 'localhost',
     *         port: 5432,
     *         username: 'postgres',
     *         password: 'password',
     *         database: 'bustransit'
     *       },
     *       autoArchive: true
     *     })
     *   ]
     * })
     * export class AppModule {}
     * ```
     */
    static forRoot(options: SagaPersistenceOptions): DynamicModule {
        // Apply defaults
        const moduleOptions: SagaPersistenceOptions = {
            type: SagaPersistenceType.InMemory,
            autoArchive: false,
            autoCreateSchema: true,
            retry: {
                attempts: 3,
                delay: 100,
                exponentialBackoff: true
            },
            ...options
        };

        const providers: Provider[] = [
            {
                provide: SAGA_PERSISTENCE_OPTIONS,
                useValue: moduleOptions
            },
            {
                provide: SAGA_SERIALIZER,
                useClass: moduleOptions.serializer || JsonSagaSerializer
            }
        ];

        // Add database-specific connection providers
        if (moduleOptions.type === SagaPersistenceType.MongoDB) {
            providers.push({
                provide: MONGODB_CONNECTION,
                useFactory: async () => {
                    const mongoose = require('mongoose');
                    const connection = await mongoose.createConnection(
                        moduleOptions.connection?.uri || 'mongodb://localhost:27017',
                        {
                            dbName: moduleOptions.connection?.database || 'bustransit',
                            maxPoolSize: moduleOptions.connection?.poolSize || 10,
                            ssl: moduleOptions.connection?.ssl || false,
                            serverSelectionTimeoutMS: moduleOptions.connection?.connectionTimeout || 5000
                        }
                    ).asPromise();
                    return connection;
                }
            });
        } else if (moduleOptions.type === SagaPersistenceType.PostgreSQL) {
            providers.push({
                provide: POSTGRESQL_CONNECTION,
                useFactory: async () => {
                    const { DataSource } = require('typeorm');
                    const { SagaStateEntity } = require('./models/postgresql/saga-state.entity');

                    const dataSource = new DataSource({
                        type: 'postgres',
                        host: moduleOptions.connection?.host || 'localhost',
                        port: moduleOptions.connection?.port || 5432,
                        username: moduleOptions.connection?.username,
                        password: moduleOptions.connection?.password,
                        database: moduleOptions.connection?.database || 'bustransit',
                        schema: moduleOptions.connection?.schema || 'public',
                        entities: [SagaStateEntity],
                        synchronize: moduleOptions.autoCreateSchema || false,
                        ssl: moduleOptions.connection?.ssl || false
                    });

                    await dataSource.initialize();
                    return dataSource;
                }
            });
        }

        // Repository factory provider
        providers.push({
            provide: SAGA_REPOSITORY,
            useFactory: (
                opts: SagaPersistenceOptions,
                serializer,
                mongoConnection?: Connection,
                postgresConnection?: DataSource
            ) => {
                return SagaRepositoryFactory.create(
                    opts,
                    serializer,
                    mongoConnection,
                    postgresConnection
                );
            },
            inject: [
                SAGA_PERSISTENCE_OPTIONS,
                SAGA_SERIALIZER,
                { token: MONGODB_CONNECTION, optional: true },
                { token: POSTGRESQL_CONNECTION, optional: true }
            ]
        });

        return {
            module: SagaPersistenceModule,
            providers,
            exports: [
                SAGA_REPOSITORY,
                SAGA_PERSISTENCE_OPTIONS,
                SAGA_SERIALIZER
            ],
            global: true
        };
    }

    /**
     * Configure saga persistence module asynchronously
     * Useful for injecting ConfigService or other async dependencies
     *
     * @example
     * ```typescript
     * @Module({
     *   imports: [
     *     SagaPersistenceModule.forRootAsync({
     *       imports: [ConfigModule],
     *       useFactory: (config: ConfigService) => ({
     *         type: SagaPersistenceType.PostgreSQL,
     *         connection: {
     *           host: config.get('DB_HOST'),
     *           port: config.get('DB_PORT'),
     *           username: config.get('DB_USER'),
     *           password: config.get('DB_PASS'),
     *           database: config.get('DB_NAME')
     *         },
     *         autoArchive: config.get('SAGA_AUTO_ARCHIVE', true),
     *         retry: {
     *           attempts: config.get('SAGA_RETRY_ATTEMPTS', 5),
     *           delay: config.get('SAGA_RETRY_DELAY', 200)
     *         }
     *       }),
     *       inject: [ConfigService]
     *     })
     *   ]
     * })
     * export class AppModule {}
     * ```
     */
    static forRootAsync(options: SagaPersistenceAsyncOptions): DynamicModule {
        const providers: Provider[] = [
            {
                provide: SAGA_PERSISTENCE_OPTIONS,
                useFactory: async (...args: any[]) => {
                    const opts = await options.useFactory(...args);
                    // Apply defaults
                    return {
                        type: SagaPersistenceType.InMemory,
                        autoArchive: false,
                        autoCreateSchema: true,
                        retry: {
                            attempts: 3,
                            delay: 100,
                            exponentialBackoff: true
                        },
                        ...opts
                    };
                },
                inject: options.inject || []
            },
            {
                provide: SAGA_SERIALIZER,
                useFactory: (opts: SagaPersistenceOptions) => {
                    return opts.serializer ? new opts.serializer() : new JsonSagaSerializer();
                },
                inject: [SAGA_PERSISTENCE_OPTIONS]
            }
        ];

        // MongoDB connection provider
        providers.push({
            provide: MONGODB_CONNECTION,
            useFactory: async (opts: SagaPersistenceOptions) => {
                if (opts.type !== SagaPersistenceType.MongoDB) return null;

                const mongoose = require('mongoose');
                const connection = await mongoose.createConnection(
                    opts.connection?.uri || 'mongodb://localhost:27017',
                    {
                        dbName: opts.connection?.database || 'bustransit',
                        maxPoolSize: opts.connection?.poolSize || 10,
                        ssl: opts.connection?.ssl || false,
                        serverSelectionTimeoutMS: opts.connection?.connectionTimeout || 5000
                    }
                ).asPromise();
                return connection;
            },
            inject: [SAGA_PERSISTENCE_OPTIONS]
        });

        // PostgreSQL connection provider
        providers.push({
            provide: POSTGRESQL_CONNECTION,
            useFactory: async (opts: SagaPersistenceOptions) => {
                if (opts.type !== SagaPersistenceType.PostgreSQL) return null;

                const { DataSource } = require('typeorm');
                const { SagaStateEntity } = require('./models/postgresql/saga-state.entity');

                const dataSource = new DataSource({
                    type: 'postgres',
                    host: opts.connection?.host || 'localhost',
                    port: opts.connection?.port || 5432,
                    username: opts.connection?.username,
                    password: opts.connection?.password,
                    database: opts.connection?.database || 'bustransit',
                    schema: opts.connection?.schema || 'public',
                    entities: [SagaStateEntity],
                    synchronize: opts.autoCreateSchema || false,
                    ssl: opts.connection?.ssl || false
                });

                await dataSource.initialize();
                return dataSource;
            },
            inject: [SAGA_PERSISTENCE_OPTIONS]
        });

        // Repository factory provider
        providers.push({
            provide: SAGA_REPOSITORY,
            useFactory: (
                opts: SagaPersistenceOptions,
                serializer,
                mongoConnection?: Connection,
                postgresConnection?: DataSource
            ) => {
                return SagaRepositoryFactory.create(
                    opts,
                    serializer,
                    mongoConnection,
                    postgresConnection
                );
            },
            inject: [
                SAGA_PERSISTENCE_OPTIONS,
                SAGA_SERIALIZER,
                { token: MONGODB_CONNECTION, optional: true },
                { token: POSTGRESQL_CONNECTION, optional: true }
            ]
        });

        return {
            module: SagaPersistenceModule,
            imports: options.imports || [],
            providers,
            exports: [
                SAGA_REPOSITORY,
                SAGA_PERSISTENCE_OPTIONS,
                SAGA_SERIALIZER
            ],
            global: true
        };
    }
}
