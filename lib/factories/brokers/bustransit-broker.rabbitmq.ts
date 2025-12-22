import * as amqp from 'amqplib';
import { v7 as uuidv7 } from 'uuid';
import { IBusTransitBrokerOptions } from '../../interfaces/brokers/bustransit-broker.options.interface';
import { BusTransitBrokerBaseFactory } from './bustransit-broker.base';
import { Inject, Injectable, Logger, ParamData } from '@nestjs/common';
import { ConsumerConfigurator } from '../consumer.configurator';
import {
    catchError,
    defer,
    delay,
    delayWhen,
    every,
    finalize,
    interval,
    last,
    lastValueFrom,
    map,
    mergeMap,
    Observable,
    of,
    retry,
    retryWhen,
    Subject,
    switchMap,
    take,
    takeUntil,
    tap,
    throwError,
    timer,
} from 'rxjs';
import * as os from 'os';
import { BusTransitStateMachine } from '../saga.bustransit.state-machine';
import { BusTransitConsumer } from '../consumer';
import { ConsumeMessage } from 'amqplib';
import { addMilliseconds } from '../../utils/date';
import { retryWithDelay } from '../retry.utils';
import { EndpointRegistrationConfigurator } from '../endpoint.registration.configurator';
import { BehaviorContext } from '../behavior.context';
import { SagaStateMachineInstance } from '../saga.state-machine-instance';
import { IMessage } from '../../interfaces/message.interface';
import { IPublishEndpoint } from '../../interfaces';

@Injectable()
export class BusTransitBrokerRabbitMqFactory extends BusTransitBrokerBaseFactory {
    brokerName = 'RabbitMq';
    brokerConfig: IBusTransitBrokerOptions;
    private channelProducer = '_producer';

    private connection: amqp.ChannelModel;
    private channelList: Map<string, amqp.Channel> = new Map<string, amqp.Channel>();
    private reconnectDelay = 5000;
    private isConnecting = false;
    private delayedMessagePluginSupported: boolean = false;
    private queueRedeliveryEnabled: Map<string, boolean> = new Map<string, boolean>();

    public async start() {
        if (this.isConnecting) return;
        this.isConnecting = true;

        const brokerInfo = this.brokerConfig.brokerInfo;

        const connectString = `amqp://${brokerInfo['username']}:${brokerInfo['password']}@${brokerInfo['host']}:${brokerInfo['port']}${brokerInfo['vhost']}`;
        try {
            this.connection = await amqp.connect(connectString, {
                clientProperties: { connection_name: this.brokerConfig.brokerName },
            });

            await this.createChannel(this.channelProducer, {});
            await this.checkDelayedMessagePlugin();
            const exchangeCreated = await this.startAllConsumer();

            this.connection.on('close', () => {
                console.warn('[RabbitMQ] Connection closed, retrying...');
                setTimeout(() => this.start(), this.reconnectDelay);
            });
        } catch (e) {
            console.error('[RabbitMQ] Connection failed, retrying in 5s', e);
            setTimeout(() => this.start(), this.reconnectDelay);
        } finally {
            this.isConnecting = false;
        }
    }

    private getProducerChannel(): amqp.Channel {
        return this.channelList[this.channelProducer];
    }

    /**
     * Get the status of x-delayed-message plugin support
     */
    public isDelayedMessagePluginSupported(): boolean {
        return this.delayedMessagePluginSupported;
    }

    /**
     * Check if redelivery is enabled for a specific queue
     * Redelivery requires both configuration AND x-delayed-message plugin support
     */
    public isRedeliveryEnabledForQueue(queueName: string): boolean {
        return this.queueRedeliveryEnabled.get(queueName) ?? false;
    }

    /**
     * Check if RabbitMQ x-delayed-message plugin is installed
     * Uses a temporary channel to avoid affecting the main producer channel
     */
    private async checkDelayedMessagePlugin(): Promise<void> {
        let testChannel: amqp.Channel | null = null;
        const testExchangeName = '_test_delayed_exchange_' + Date.now();

        try {
            // Create a temporary channel for testing to avoid affecting the main producer channel
            testChannel = await this.connection.createChannel();

            // Suppress channel errors during the test
            testChannel.on('error', (err) => {
                // Expected error when plugin is not available
                Logger.debug(`[RabbitMQ] Test channel error (expected if plugin not installed): ${err.message}`);
            });

            // Try to create a delayed exchange to test plugin availability
            await testChannel.assertExchange(testExchangeName, 'x-delayed-message', {
                autoDelete: true,
                durable: false,
                arguments: { 'x-delayed-type': 'direct' }
            });

            // If successful, delete the test exchange
            await testChannel.deleteExchange(testExchangeName);

            this.delayedMessagePluginSupported = true;
            Logger.log('[RabbitMQ] ✓ x-delayed-message plugin is available');
        } catch (error) {
            this.delayedMessagePluginSupported = false;
            Logger.warn(
                '[RabbitMQ] ⚠ WARNING: x-delayed-message plugin is NOT installed or not enabled. ' +
                'Delayed/scheduled message features will not work. ' +
                'Please install the plugin: https://github.com/rabbitmq/rabbitmq-delayed-message-exchange'
            );
            Logger.debug(`[RabbitMQ] Plugin check error: ${error.message}`);
        } finally {
            // Always close the test channel
            if (testChannel) {
                try {
                    await testChannel.close();
                } catch (closeError) {
                    // Channel might already be closed by RabbitMQ
                    Logger.debug(`[RabbitMQ] Test channel close: ${closeError.message}`);
                }
            }
        }
    }

    public setBrokerConfig(brokerConfig: IBusTransitBrokerOptions) {
        this.brokerConfig = brokerConfig;
    }

    async createAllExchange(exchangeCreatedFromConsumers) {
        Logger.debug(`Created All Exchange`);
        const exchanges = [];
        for (const [key, consumerClass] of Object.entries(this.consumers)) {
            const consumer = consumerClass as any;
            const bus = this.moduleRef.get(consumer) as BusTransitConsumer<any>;
            // IF had .Endpoint()
            if (consumer.EndpointRegistrationConfigurator) {
                this.classMessageToEndpoint[bus.GetMessageClass.name] =
                    consumer.EndpointRegistrationConfigurator;
            }

            // If consumer is Saga
            if (Object.getPrototypeOf(consumerClass) === BusTransitStateMachine) {
                const _busSaga = bus as BusTransitStateMachine<any>;

                //console.log('exchange saga: ' + _busSaga.GetMessageClass.name + ' <- ' + consumer.EndpointRegistrationConfigurator.Name);
                exchanges.push({
                    exchangeName: _busSaga.GetMessageClass.name,
                    bindTo: null,
                });

                for (const [event, value] of Object.entries(_busSaga.GetEvents)) {
                    const getExchange = event;
                    this.classMessageToEndpoint[event] = new EndpointRegistrationConfigurator();
                    this.classMessageToEndpoint[event].Name =
                        this.classMessageToExchange[_busSaga.GetMessageClass.name];

                    await this.assertExchange(
                        this.channelList[this.channelProducer],
                        getExchange,
                        'fanout',
                    );
                    //console.log('exchange GetEvents: ' + getExchange + ' <- ' + consumer.EndpointRegistrationConfigurator.Name);
                    exchanges.push({
                        exchangeName: getExchange,
                        bindTo: this.classMessageToEndpoint[event].Name,
                    });
                }

                for (const [stateKey, value] of Object.entries(_busSaga.GetBehaviours)) {
                    const getExchange = stateKey;
                    // console.log('exchange GetBehaviours: ' + getExchange);
                    exchanges.push({
                        exchangeName: getExchange,
                        bindTo: null,
                    });
                }

                continue;
            }
        }

        // AddConsumer
        for (const exchange of exchanges) {
            await this.assertExchange(
                this.channelList[this.channelProducer],
                exchange.exchangeName,
                'fanout',
            );
            if (exchange.bindTo) {
                await this.assertExchange(
                    this.channelList[this.channelProducer],
                    exchange.bindTo,
                    'fanout',
                );
                await this.channelList[this.channelProducer].bindExchange(
                    this.getNameAddClusterPrefix(exchange.bindTo),
                    this.getNameAddClusterPrefix(exchange.exchangeName),
                    '',
                );
            }
        }

        // ReceiveEndpoint => ConfigureConsumer
        for (const exchange of exchangeCreatedFromConsumers) {
            await this.assertExchange(
                this.channelList[this.channelProducer],
                exchange.exchangeName,
                'fanout',
            );
            if (exchange.bindTo) {
                await this.assertExchange(
                    this.channelList[this.channelProducer],
                    exchange.bindTo,
                    'fanout',
                );
                await this.channelList[this.channelProducer].bindExchange(
                    this.getNameAddClusterPrefix(exchange.bindTo),
                    this.getNameAddClusterPrefix(exchange.exchangeName),
                    '',
                );
            }
        }
    }

    public async startAllConsumer() {
        Logger.debug('begin startAllConsumer');

        /* Map<String, String> { endpoint : consumer } */
        const exchangeCreated = [];

        // Các consumer bao gồm cả sagas và consumers
        for (const [queueName, consumerCfg] of Object.entries(this.consumersToEndpoint)) {
            const consumer = (consumerCfg as ConsumerConfigurator).consumer;
            const consumerState = (this.moduleRef.get(consumer) as BusTransitConsumer<any>)
                .GetMessageClass;
            exchangeCreated.push({
                exchangeName: consumerState?.name,
                bindTo: queueName,
            });
            // Mapping queue to Message
            this.classConsumerToEndpoint[consumer?.name] = queueName;
            this.classMessageToExchange[consumerState?.name] = queueName;
        }

        super.startAllConsumer();
        await this.createAllExchange(exchangeCreated);

        for (const [queueName, consumerCfg] of Object.entries(this.consumersToEndpoint)) {
            const consumer = (consumerCfg as ConsumerConfigurator).consumer;
            const options = (consumerCfg as ConsumerConfigurator).options;
            const retryPattern = (consumerCfg as ConsumerConfigurator).retryPattern;
            const redeliveryPattern = (consumerCfg as ConsumerConfigurator).redeliveryPattern;

            Logger.debug(`Started Consumer ${consumer?.name} <- ${queueName}`);

            await this.createChannel(queueName, options);
            await this.bindConsumerToQueue(
                {
                    consumer: consumer,
                    retryPattern: retryPattern,
                    redeliveryPattern: redeliveryPattern,
                },
                queueName,
                queueName,
            );
        }

        return exchangeCreated;
    }

    protected async createChannel(queueName: string, options) {
        const channel = await this.connection.createChannel();
        await channel.prefetch(options.PrefetchCount);

        // Add error handler to prevent uncaught channel errors
        channel.on('error', (err) => {
            Logger.error(`[RabbitMQ] Channel error for '${queueName}': ${err.message}`);
        });

        channel.on('close', () => {
            Logger.warn(`[RabbitMQ] Channel closed for '${queueName}'`);
        });

        this.channelList[queueName] = channel;
    }

    protected async bindConsumerToQueue(
        bindConsume: { consumer: Function; retryPattern: any; redeliveryPattern: any },
        queueName: string,
        exchange?: string,
    ) {
        await this.checkQueueAndAssert(
            queueName,
            async () => {
                const channel = this.channelList[queueName];
                // Check if redelivery can be enabled (requires both configuration AND plugin support)
                const delayExchange = `delayed.exchange.${queueName}`;
                const canEnableRedelivery = bindConsume.redeliveryPattern && this.delayedMessagePluginSupported;

                if (bindConsume.redeliveryPattern) {
                    if (!this.delayedMessagePluginSupported) {
                        // Redelivery requested but plugin not available
                        this.queueRedeliveryEnabled.set(queueName, false);
                        Logger.warn(
                            `[RabbitMQ] Redelivery pattern configured for queue '${queueName}' but x-delayed-message plugin is NOT available. ` +
                            `Redelivery is DISABLED. Install plugin: https://github.com/rabbitmq/rabbitmq-delayed-message-exchange`
                        );
                    } else {
                        // Redelivery enabled: create delayed exchange
                        try {
                            await this.assertExchange(channel, delayExchange, 'x-delayed-message', {
                                autoDelete: false,
                                durable: true,
                                arguments: { 'x-delayed-type': 'direct' },
                            });
                            await channel.bindQueue(queueName, this.getNameAddClusterPrefix(delayExchange), '');

                            this.queueRedeliveryEnabled.set(queueName, true);
                            Logger.log(`[RabbitMQ] ✓ Redelivery enabled for queue '${queueName}'`);
                        } catch (error) {
                            // Failed to create delayed exchange even though plugin check passed
                            this.queueRedeliveryEnabled.set(queueName, false);
                            this.delayedMessagePluginSupported = false; // Update global flag

                            Logger.error(
                                `[RabbitMQ] ✗ Failed to create delayed exchange for queue '${queueName}'. ` +
                                `Error: ${error.message}. Redelivery is DISABLED.`
                            );
                            Logger.warn(
                                `[RabbitMQ] This may indicate the x-delayed-message plugin became unavailable ` +
                                `or there are permission issues. All queues will have redelivery disabled.`
                            );
                        }
                    }
                } else {
                    // No redelivery configured
                    this.queueRedeliveryEnabled.set(queueName, false);
                }

                channel
                    .consume(
                        queueName,
                        (message) => {
                            const jsonMsg = JSON.parse(message.content.toString());
                            const secs = message.content.toString().split('.').length - 1;

                            const consumerFunc = async (_message, _jsonMsg) => {
                                const consumerInstance = this.moduleRef.get(bindConsume.consumer);
                                consumerInstance.producer = this.moduleRef.get(IPublishEndpoint);

                                const ctx = new BehaviorContext<SagaStateMachineInstance, any>();
                                ctx.Saga = _jsonMsg.headers?.saga;

                                const rs = await consumerInstance.Consume(ctx, {
                                    ..._message,
                                    Message: _jsonMsg.message,
                                } as IMessage<any>);

                                if (
                                    _message.properties.replyTo &&
                                    _message.properties.correlationId
                                ) {
                                    // Reply if had
                                    channel.publish(
                                        '',
                                        _message.properties.replyTo,
                                        Buffer.from(JSON.stringify(rs ?? true)),
                                        {
                                            // Empty exchange
                                            correlationId: _message.properties.correlationId,
                                        },
                                    );
                                    // Logger.log(`[x] Reply to ${message.properties.replyTo}, correlationId ${message.properties.correlationId}`);
                                }

                                setTimeout(function () {
                                    channel.ack(_message);
                                }, secs * 1000);
                            };

                            const retryPattern = bindConsume.retryPattern ?? {
                                pipe: retryWithDelay({ maxRetryAttempts: 0, delay: 0 }),
                            };
                            const redeliveryPattern = bindConsume.redeliveryPattern ?? {
                                pipe: retryWithDelay({ maxRetryAttempts: 0, delay: 0 }),
                            };
                            const start = performance.now();

                            of(null)
                                .pipe(
                                    mergeMap(() => {
                                        return consumerFunc(message, jsonMsg);
                                    }),
                                    retryPattern.pipe,
                                )
                                .subscribe({
                                    next: (data) => {},
                                    error: async (err) => {
                                        console.log(err);
                                        Logger.error('RabbitMQ Message error', err.message);

                                        const queueDeclared = `${queueName}`;

                                        // Redelivery pattern - only if enabled for this queue (requires plugin support)
                                        const isRedeliveryEnabled = this.queueRedeliveryEnabled.get(queueName) ?? false;

                                        if (redeliveryPattern && redeliveryPattern.retryValue && isRedeliveryEnabled) {
                                            const indexRedelivery = message.properties.headers?.['x-redelivery'] ?? 0;

                                            // Determine delay based on retry type
                                            let delayMs = 0;
                                            let maxRetries = 0;

                                            switch (redeliveryPattern.retryType) {
                                                case 0: // Retry.Immediate
                                                    maxRetries = redeliveryPattern.retryValue;
                                                    delayMs = 0;
                                                    break;
                                                case 1: // Retry.Interval
                                                    maxRetries = redeliveryPattern.retryValue[0];
                                                    delayMs = redeliveryPattern.retryValue[1];
                                                    break;
                                                case 2: // Retry.Intervals
                                                    maxRetries = redeliveryPattern.retryValue.length;
                                                    delayMs = indexRedelivery < redeliveryPattern.retryValue.length
                                                        ? redeliveryPattern.retryValue[indexRedelivery]
                                                        : 0;
                                                    break;
                                                case 3: // Retry.Exponential
                                                    maxRetries = redeliveryPattern.retryValue[0];
                                                    const initialDelay = redeliveryPattern.retryValue[1];
                                                    const scalingFactor = redeliveryPattern.retryValue[2];
                                                    delayMs = initialDelay * Math.pow(scalingFactor, indexRedelivery);
                                                    break;
                                            }

                                            if (indexRedelivery < maxRetries) {
                                                Logger.log(`[RabbitMQ] Redelivery: Attempt ${indexRedelivery + 1}/${maxRetries}: retrying in ${delayMs}ms`);

                                                try {
                                                    this.channelList[queueName].publish(
                                                        this.getNameAddClusterPrefix(delayExchange),
                                                        '',
                                                        Buffer.from(JSON.stringify(jsonMsg), "utf-8"),
                                                        {
                                                            headers: {
                                                                ...message.properties.headers,
                                                                "x-delay": delayMs,
                                                                "x-redelivery": Number(indexRedelivery) + 1,
                                                            }
                                                        }
                                                    );

                                                    channel.ack(message);
                                                    return;
                                                } catch (redeliveryErr) {
                                                    Logger.error('Failed to publish redelivery message', redeliveryErr.message);
                                                }
                                            } else {
                                                Logger.warn(`[RabbitMQ] Redelivery: Max attempts (${maxRetries}) reached for message`);
                                            }
                                        } else if (redeliveryPattern && redeliveryPattern.retryValue && !isRedeliveryEnabled) {
                                            // Redelivery configured but not enabled (plugin not available)
                                            Logger.warn(
                                                `[RabbitMQ] Redelivery pattern configured but DISABLED for queue '${queueName}' - ` +
                                                `x-delayed-message plugin not available. Message will be sent to error queue.`
                                            );
                                        }

                                        // Move to Error queue
                                        await this.checkQueueAndAssert(
                                            queueDeclared,
                                            () => {
                                                const errorPayload = {
                                                    headers: message.properties.headers,
                                                    message: jsonMsg,
                                                    host: this.getSystemInfo(),
                                                    error: {
                                                        stack: err.stack,
                                                        message: err.message,
                                                        timestamp: new Date().toISOString(),
                                                    },
                                                    retryHistory: {
                                                        immediateRetries: message.properties.headers?.['x-retry-count'] ?? 0,
                                                        redeliveryAttempts: message.properties.headers?.['x-redelivery'] ?? 0,
                                                    }
                                                };

                                                this.channelList[queueName].sendToQueue(
                                                    `${queueDeclared}_error`,
                                                    Buffer.from(JSON.stringify(errorPayload), 'utf-8'),
                                                );

                                                Logger.error(
                                                    `Message moved to error queue: ${queueDeclared}_error. ` +
                                                    `Immediate retries: ${errorPayload.retryHistory.immediateRetries}, ` +
                                                    `Redelivery attempts: ${errorPayload.retryHistory.redeliveryAttempts}`
                                                );
                                            },
                                            {
                                                suffix: '_error',
                                            },
                                        );

                                        setTimeout(function () {
                                            channel.ack(message);
                                        }, secs * 1000);
                                    },
                                    complete: () => {
                                        // Logger.log(`Completed consumer message ${bindConsume.consumer.name}, time: ${performance.now() - start}ms`)
                                    },
                                });
                        },
                        {
                            noAck: false,
                        },
                    )
                    .then((r) => {});
            },
            {
                exchange: {
                    name: exchange,
                    type: 'fanout',
                },
            },
        );
    }

    private async checkQueueAndAssert(
        queueName: string,
        callback,
        options?: { exchange?: { name: string; type: string }; suffix?: string },
    ) {
        this.channelList[queueName]
            .assertQueue(`${queueName}${options?.suffix ?? ''}`, {
                durable: true,
            })
            .then(async () => {
                if (options.exchange) {
                    await this.channelList[queueName].bindQueue(
                        queueName,
                        this.getNameAddClusterPrefix(options.exchange?.name),
                        '',
                    );
                }
                callback();
            });
    }

    private async assertExchange(channel, exchangeName: string, type: string, options: any = {}) {
        // Using cluster name if it had
        const _exchangeName = this.getNameAddClusterPrefix(exchangeName);
        await channel.assertExchange(_exchangeName, type, {
            durable: true,
            ...options,
        });
        return _exchangeName;
    }

    private getSystemInfo() {
        return {
            machineName: os.hostname(),
            processName: process.title,
            processId: process.pid, // Thay thế bằng version assembly thực tế của bạn (nếu có)
            frameworkVersion: process.version, // Thay thế bằng version MassTransit thực tế của bạn (nếu có)
            operatingSystemVersion: `${os.type()} ${os.release()}`,
        };
    }

    public close() {}

    protected getNameAddClusterPrefix(name) {
        const _name = `${this.brokerConfig.brokerName ? `${this.brokerConfig.brokerName}:` : ''}${name}`;
        return _name;
    }

    // Message functions
    async publish<TMessage>(message: TMessage, ctx?: BehaviorContext<any, TMessage>) {
        // Trường hợp Message không có exchange trong process thì push thẳng vào tên exchange ??
        const exchange = this.getNameAddClusterPrefix(
            this.classMessageToExchange[message.constructor.name] ??
                this.classMessageToEndpoint[message.constructor.name]?.Name ??
                message.constructor.name,
        );
        const msg = {
            messageId: uuidv7(),
            type: 'publish',
            sourceAddress: `rabbitmq://${this.brokerConfig.brokerInfo.host}/${this.channelProducer}`, // TODO
            destinationAddress: `rabbitmq://${this.brokerConfig.brokerInfo.host}/exchange/${exchange}`,
            messageType: `message:${this.brokerConfig.brokerName}:${message.constructor.name}`,
            message: message,
            sentTime: new Date().toString(),
            expirationTime: null,
            headers: {
                saga: ctx?.Saga,
            },
        } as IMessage<any>;
        (await this.getProducerChannel()).publish(
            exchange,
            '',
            Buffer.from(JSON.stringify(msg), 'utf-8'),
            {
                persistent: true,
            },
        );
    }

    /* Bản chất rabbitmq không thể async khi publish được, sử dụng sendQueue instead */
    async publishAsync<TMessage>(
        message: TMessage,
        ctx?: BehaviorContext<any, TMessage>,
    ): Promise<any> {
        const classMessage = this.classMessageToEndpoint[message.constructor.name];
        const endpoint = classMessage.EndpointRegistrationConfigurator?.Name ?? this.classMessageToEndpoint[message.constructor.name]?.Name ?? message.constructor.name;
        const correlationId = uuidv7();
        const replyQueueName = 'amq.rabbitmq.reply-to';
        const timeout = 10000;

        const channelTemp = await this.connection.createChannel();

        return new Promise(async (resolve, reject) => {
            // Create a temporary consumer to receive feedback
            const consumeResult = await channelTemp.consume(
                replyQueueName,
                (replyMessage: ConsumeMessage | null) => {
                    if (replyMessage && replyMessage.properties.correlationId === correlationId) {
                        // Decode and return the response content
                        try {
                            const reply = JSON.parse(replyMessage.content.toString());
                            resolve(reply); // Resolve promise với dữ liệu
                        } catch (error) {
                            reject(error); // Reject if there is an error when parsing JSON
                        } finally {
                            channelTemp
                                .cancel(consumeResult.consumerTag)
                                .catch((e) => console.error('Failed to cancel consumer', e)); // Hủy consumer
                        }
                    }
                },
                { noAck: true },
            );

            // Timeout để xử lý trường hợp không có phản hồi
            const timer = setTimeout(() => {
                reject(new Error(`No response received after ${timeout}ms`));
                channelTemp.cancel(consumeResult.consumerTag); // Hủy consumer
            }, timeout);

            // console.log('*** saga');
            try {
                const msg = {
                    messageId: uuidv7(),
                    type: 'publishAsync',
                    sourceAddress: `rabbitmq://${this.brokerConfig.brokerInfo.host}/${replyQueueName}`, // TODO
                    destinationAddress: `rabbitmq://${this.brokerConfig.brokerInfo.host}/queue/${endpoint ?? ''}`,
                    messageType: `message:${this.brokerConfig.brokerName}:${message.constructor.name}`,
                    message: message,
                    sentTime: new Date().toString(),
                    expirationTime: addMilliseconds(new Date(), timeout).toString(),
                    headers: {
                        saga: ctx?.Saga,
                    },
                } as IMessage<any>;

                channelTemp.publish('', endpoint, Buffer.from(JSON.stringify(msg), 'utf-8'), {
                    replyTo: replyQueueName,
                    correlationId: correlationId,
                    persistent: true,
                });

                Logger.debug(
                    `[x] Sent msg to ${endpoint} with MSG ${JSON.stringify(msg)}, replyTo ${replyQueueName}`,
                );
            } catch (error) {
                clearTimeout(timer);
                reject(error);
                channelTemp
                    .cancel(consumeResult.consumerTag)
                    .catch((e) => console.error('Failed to cancel consumer', e));
            } finally {
            }
        });
    }
}
