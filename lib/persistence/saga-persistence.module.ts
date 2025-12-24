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
        switch (moduleOptions.type) {
            case SagaPersistenceType.MongoDB:
                providers.push({
                    provide: MONGODB_CONNECTION,
                    useFactory: async () => {
                        const { Logger } = require('@nestjs/common');
                        const logger = new Logger('SagaPersistenceModule');

                        logger.log('[MongoDB] Initializing MongoDB connection for saga persistence...');
                        logger.log(`[MongoDB] Config: ${moduleOptions.connection?.uri?.replace(/\/\/([^:]+):([^@]+)@/, '//$1:****@')}`);
                        logger.log(`[MongoDB] Database: ${moduleOptions.connection?.database || 'bustransit'}`);

                        const mongoose = require('mongoose');

                        try {
                            const connection = await mongoose.connect(
                                moduleOptions.connection?.uri,
                                {
                                    dbName: moduleOptions.connection?.database || 'bustransit',
                                    serverApi: { version: '1', strict: true, deprecationErrors: true },
                                    ...moduleOptions.tlsOptions,
                                }
                            );
                            await mongoose.connection.db.admin().command({ ping: 1 });

                            logger.log('[MongoDB] Connection established successfully');
                            logger.log('[MongoDB] Pinged deployment successfully');
                            logger.log(`[MongoDB] Collection '${moduleOptions.connection?.collectionName || 'saga_states'}' should be ready`);
                            return connection;
                        } catch (error) {
                            logger.error('[MongoDB] Failed to initialize connection:', error.message);
                            throw error;
                        }
                    }
                });
                break;

            case SagaPersistenceType.PostgreSQL:
                providers.push({
                    provide: POSTGRESQL_CONNECTION,
                    useFactory: async () => {
                        const { Logger } = require('@nestjs/common');
                        const logger = new Logger('SagaPersistenceModule');

                        logger.log('[PostgreSQL] Initializing PostgreSQL connection for saga persistence...');
                        logger.log(`[PostgreSQL] Config: ${moduleOptions.connection?.host}:${moduleOptions.connection?.port}/${moduleOptions.connection?.database}`);
                        logger.log(`[PostgreSQL] Auto-create schema: ${moduleOptions.autoCreateSchema !== false}`);

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
                            synchronize: moduleOptions.autoCreateSchema !== false,
                            ssl: moduleOptions.connection?.ssl || false,
                            logging: true
                        });

                        try {
                            await dataSource.initialize();
                            logger.log('[PostgreSQL] Connection established successfully');
                            logger.log('[PostgreSQL] Table saga_states should be ready');
                            return dataSource;
                        } catch (error) {
                            logger.error('[PostgreSQL] Failed to initialize connection:', error.message);
                            throw error;
                        }
                    }
                });
                break;

            case SagaPersistenceType.InMemory:
            case SagaPersistenceType.Custom:
                // No connection provider needed for InMemory or Custom
                break;
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

        // Database connection providers (always register both with optional support)
        providers.push({
            provide: MONGODB_CONNECTION,
            useFactory: async (opts: SagaPersistenceOptions) => {
                if (opts.type !== SagaPersistenceType.MongoDB) return null;

                const { Logger } = require('@nestjs/common');
                const logger = new Logger('SagaPersistenceModule');

                logger.log('[MongoDB] Initializing MongoDB connection for saga persistence (async)...');
                logger.log(`[MongoDB] Config: ${opts.connection?.uri?.replace(/\/\/([^:]+):([^@]+)@/, '//$1:****@')}`);
                logger.log(`[MongoDB] Database: ${opts.connection?.database || 'bustransit'}`);

                const mongoose = require('mongoose');

                try {
                    const connection = await mongoose.connect(
                        opts.connection?.uri || 'mongodb://localhost:27017',
                        {
                            dbName: opts.connection?.database || 'bustransit',
                            serverApi: { version: '1', strict: true, deprecationErrors: true },
                            ...opts.connection,
                            ...opts.tlsOptions,
                        }
                    );

                    // Set up connection event listeners
                    mongoose.connection.on('connected', () => logger.log('[MongoDB] Connection event: connected'));
                    mongoose.connection.on('open', () => logger.log('[MongoDB] Connection event: open'));
                    mongoose.connection.on('disconnected', () => logger.warn('[MongoDB] Connection event: disconnected'));
                    mongoose.connection.on('reconnected', () => logger.log('[MongoDB] Connection event: reconnected'));
                    mongoose.connection.on('disconnecting', () => logger.log('[MongoDB] Connection event: disconnecting'));
                    mongoose.connection.on('close', () => logger.log('[MongoDB] Connection event: close'));
                    mongoose.connection.on('error', (err: Error) => logger.error('[MongoDB] Connection error:', err.message));

                    // Verify connection with ping
                    await mongoose.connection.db.admin().command({ ping: 1 });

                    logger.log('[MongoDB] Connection established successfully (async)');
                    logger.log('[MongoDB] Pinged deployment successfully');
                    logger.log(`[MongoDB] Collection '${opts.connection?.collectionName || 'saga_states'}' should be ready`);
                    return connection;
                } catch (error) {
                    logger.error('[MongoDB] Failed to initialize connection (async):', error.message);
                    throw error;
                }
            },
            inject: [SAGA_PERSISTENCE_OPTIONS]
        });

        providers.push({
            provide: POSTGRESQL_CONNECTION,
            useFactory: async (opts: SagaPersistenceOptions) => {
                if (opts.type !== SagaPersistenceType.PostgreSQL) return null;

                const { Logger } = require('@nestjs/common');
                const logger = new Logger('SagaPersistenceModule');

                logger.log('[PostgreSQL] Initializing PostgreSQL connection for saga persistence (async)...');
                logger.log(`[PostgreSQL] Config: ${opts.connection?.host}:${opts.connection?.port}/${opts.connection?.database}`);
                logger.log(`[PostgreSQL] Auto-create schema: ${opts.autoCreateSchema !== false}`);

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
                    synchronize: opts.autoCreateSchema !== false,
                    ssl: opts.connection?.ssl || false,
                    logging: true
                });

                try {
                    await dataSource.initialize();
                    logger.log('[PostgreSQL] Connection established successfully (async)');
                    logger.log('[PostgreSQL] Table saga_states should be ready');
                    return dataSource;
                } catch (error) {
                    logger.error('[PostgreSQL] Failed to initialize connection (async):', error.message);
                    throw error;
                }
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
