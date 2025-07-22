import * as amqp from 'amqplib';
import { v7 as uuidv7 } from 'uuid';
import {IBusTransitBrokerOptions} from "../../interfaces/brokers/bustransit-broker.options.interface";
import {BusTransitBrokerBaseFactory} from "./bustransit-broker.base";
import {Inject, Injectable, Logger, ParamData} from "@nestjs/common";
import {ConsumerConfigurator} from "../consumer.configurator";
import {
    catchError,
    defer,
    delay,
    delayWhen,
    every,
    finalize,
    interval,
    last,
    lastValueFrom, map,
    mergeMap, Observable, of, retry,
    retryWhen, Subject, switchMap,
    take, takeUntil,
    tap, throwError, timer
} from 'rxjs';
import * as os from "os";
import {BusTransitStateMachine} from "../saga.bustransit.state-machine";
import {BusTransitConsumer} from "../consumer";
import {ConsumeMessage} from "amqplib";
import {addMilliseconds} from "../../utils/date";
import {retryWithDelay} from "../retry.utils";
import {EndpointRegistrationConfigurator} from "../endpoint.registration.configurator";
import {BehaviorContext} from "../behavior.context";
import {SagaStateMachineInstance} from "../saga.state-machine-instance";
import {IMessage} from "../../interfaces/message.interface";
import {IPublishEndpoint} from "../../interfaces";

@Injectable()
export class BusTransitBrokerRabbitMqFactory extends BusTransitBrokerBaseFactory
{
    brokerName = "RabbitMq"
    brokerConfig: IBusTransitBrokerOptions;
    private channelProducer = '_producer';

    private connection: amqp.ChannelModel;
    private channelList: Map<string, amqp.Channel> = new Map<string, amqp.Channel>();
    private reconnectDelay = 5000;
    private isConnecting = false;

    public async start() {
        if (this.isConnecting) return;
        this.isConnecting = true;

        const brokerInfo = this.brokerConfig.brokerInfo;

        const connectString = `amqp://${brokerInfo['username']}:${brokerInfo['password']}@${brokerInfo['host']}:${brokerInfo['port']}${brokerInfo['vhost']}`;
        try {
            this.connection = await amqp.connect(connectString, {clientProperties: {connection_name: this.brokerConfig.brokerName}});

            await this.createChannel(this.channelProducer, {});
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

    public setBrokerConfig(brokerConfig: IBusTransitBrokerOptions) {
        this.brokerConfig = brokerConfig;
    }

    async createAllExchange(exchangeCreatedFromConsumers) {
        Logger.debug(`Created All Exchange`);
        const exchanges = [];
        for (const [key, consumerClass]  of Object.entries(this.consumers)) {
            let consumer = (consumerClass as any);
            let bus = this.moduleRef.get(consumer) as BusTransitConsumer<any>;
            // IF had .Endpoint()
            if (consumer.EndpointRegistrationConfigurator) {
                this.classMessageToEndpoint[bus.GetMessageClass.name] = consumer.EndpointRegistrationConfigurator;
            }

            // If consumer is Saga
            if (Object.getPrototypeOf(consumerClass) === BusTransitStateMachine) {
                let _busSaga = (bus as BusTransitStateMachine<any>);

                //console.log('exchange saga: ' + _busSaga.GetMessageClass.name + ' <- ' + consumer.EndpointRegistrationConfigurator.Name);
                exchanges.push({
                    exchangeName: _busSaga.GetMessageClass.name,
                    bindTo: null,
                })

                for (const [event, value] of Object.entries(_busSaga.GetEvents)) {
                    let getExchange = event;
                    this.classMessageToEndpoint[event] = new EndpointRegistrationConfigurator()
                    this.classMessageToEndpoint[event].Name =  this.classMessageToExchange[_busSaga.GetMessageClass.name];

                    await this.assertExchange(this.channelList[this.channelProducer], getExchange, 'fanout');
                    //console.log('exchange GetEvents: ' + getExchange + ' <- ' + consumer.EndpointRegistrationConfigurator.Name);
                    exchanges.push({
                        exchangeName: getExchange,
                        bindTo: this.classMessageToEndpoint[event].Name
                    })
                }

                for (const [stateKey, value] of Object.entries(_busSaga.GetBehaviours)) {
                    let getExchange = stateKey;
                    // console.log('exchange GetBehaviours: ' + getExchange);
                    exchanges.push({
                        exchangeName: getExchange,
                        bindTo: null,
                    })
                }

                continue;
            }
        }

        // AddConsumer
        for (const exchange of exchanges) {
            await this.assertExchange(this.channelList[this.channelProducer], exchange.exchangeName, 'fanout');
            if (exchange.bindTo) {
                await this.assertExchange(this.channelList[this.channelProducer], exchange.bindTo, 'fanout');
                await this.channelList[this.channelProducer].bindExchange(this.getNameAddClusterPrefix(exchange.bindTo), this.getNameAddClusterPrefix(exchange.exchangeName), '')
            }
        }

        // ReceiveEndpoint => ConfigureConsumer
        for (const exchange of exchangeCreatedFromConsumers) {
            await this.assertExchange(this.channelList[this.channelProducer], exchange.exchangeName, 'fanout');
            if (exchange.bindTo) {
                await this.assertExchange(this.channelList[this.channelProducer], exchange.bindTo, 'fanout');
                await this.channelList[this.channelProducer].bindExchange(this.getNameAddClusterPrefix(exchange.bindTo), this.getNameAddClusterPrefix(exchange.exchangeName), '')
            }
        }

    }

    public async startAllConsumer()  {

        Logger.debug('begin startAllConsumer')

        /* Map<String, String> { endpoint : consumer } */
        const exchangeCreated = [];

        // Các consumer bao gồm cả sagas và consumers
        for (const [queueName, consumerCfg] of Object.entries(this.consumersToEndpoint)) {
            let consumer = (consumerCfg as ConsumerConfigurator).consumer;
            let consumerState = (this.moduleRef.get(consumer) as BusTransitConsumer<any>).GetMessageClass;
            exchangeCreated.push({
                exchangeName: consumerState?.name,
                bindTo: queueName,
            })
            // Mapping queue to Message
            this.classConsumerToEndpoint[consumer?.name] = queueName;
            this.classMessageToExchange[consumerState?.name] = queueName;
        }

        super.startAllConsumer();
        await this.createAllExchange(exchangeCreated);

        for (const [queueName, consumerCfg] of Object.entries(this.consumersToEndpoint)) {
            let consumer = (consumerCfg as ConsumerConfigurator).consumer;
            let options = (consumerCfg as ConsumerConfigurator).options;
            let retryPattern = (consumerCfg as ConsumerConfigurator).retryPattern;
            let redeliveryPattern = (consumerCfg as ConsumerConfigurator).redeliveryPattern;

            Logger.debug(`Started Consumer ${consumer?.name} <- ${queueName}`);

            await this.createChannel(queueName, options);
            await this.bindConsumerToQueue({
                consumer: consumer,
                retryPattern: retryPattern,
                redeliveryPattern: redeliveryPattern,
            }, queueName, queueName);
        }

        return exchangeCreated;
    }

    protected async createChannel(queueName: string, options) {
        let channel = await this.connection.createChannel();
        await channel.prefetch(options.PrefetchCount);

        this.channelList[queueName] = channel;
    }

    protected async bindConsumerToQueue(
        bindConsume: { consumer: Function, retryPattern: any, redeliveryPattern: any },
        queueName: string,
        exchange?: string,
    ) {
        await this.checkQueueAndAssert(queueName,async () => {
            let channel = this.channelList[queueName];
            // Sử dụng redelivery
            let delayExchange = `delayed.exchange.${queueName}`;
            if (bindConsume.redeliveryPattern) {
                // Delayed exchange
                await this.assertExchange(channel, delayExchange,"x-delayed-message", {
                    autoDelete: false,
                    durable: true,
                    arguments: {'x-delayed-type': 'direct'}
                });
                channel.bindQueue(queueName, this.getNameAddClusterPrefix(delayExchange), '');
            }

            channel.consume(queueName,  async (message) => {

                const jsonMsg = JSON.parse(message.content.toString());

                const consumerFunc = async (message) => {
                    const consumerInstance = this.moduleRef.get(bindConsume.consumer);
                    consumerInstance.producer = this.moduleRef.get(IPublishEndpoint);

                    let ctx = new BehaviorContext<SagaStateMachineInstance, any>();
                    ctx.Saga = jsonMsg.headers?.saga;

                    const rs = await consumerInstance.Consume(ctx, {
                        ...message,
                        Message: jsonMsg.message,
                    } as IMessage<any>);

                    if (message.properties.replyTo && message.properties.correlationId) {
                        // Reply if had
                        channel.publish('', message.properties.replyTo, Buffer.from(JSON.stringify(rs ?? true)), {  // Empty exchange
                            correlationId: message.properties.correlationId
                        });
                        // Logger.log(`[x] Reply to ${message.properties.replyTo}, correlationId ${message.properties.correlationId}`);
                    }
                    channel.ack(message)
                }

                const retryPattern = bindConsume.retryPattern ?? {
                    pipe: retryWithDelay({ maxRetryAttempts: 0, delay: 0 })
                };
                const redeliveryPattern = bindConsume.redeliveryPattern ?? {
                    pipe: retryWithDelay({ maxRetryAttempts: 0, delay: 0 })
                };
                const start = performance.now();

                of(null).pipe(
                    mergeMap(() => {
                        return consumerFunc(message);
                    }),
                    retryPattern.pipe,
                ).subscribe({
                    next: (data) => {},
                    error: async (err) => {
                        console.log(err);
                        Logger.error('RabbitMQ Message error', err.message)

                        let queueDeclared = `${queueName}`;

                        // TODO
                        // if (redeliveryPattern) {
                        //     let delayRoutingKey = `delayed.routing.${queueName}`;
                        //
                        //     let exchangeDLX = `exchange_${queueName}_dlx`;
                        //     let routingKeyDLX = `routing_${queueName}_dlx`;
                        //
                        //     // Logger.debug(redeliveryPattern);
                        //     // Logger.debug(message.properties.headers['x-redelivery'] ?? 0)
                        //     // Logger.debug(message.properties.headers['x-redelivery'] + 1)
                        //
                        //     let indexRedelivery = message.properties.headers['x-redelivery'] ?? 0;
                        //     if (indexRedelivery < redeliveryPattern.retryValue.length) {
                        //         Logger.log(`Redelivery: Attempt ${indexRedelivery + 1}: retrying in ${redeliveryPattern.retryValue[indexRedelivery]}ms`);
                        //         this.channelList[queueName].publish(this.getNameAddClusterPrefix(delayExchange), '',  Buffer.from(JSON.stringify(jsonMsg), "utf-8"), {
                        //             headers: {
                        //                 ...message.properties.headers,
                        //                 "x-delay": redeliveryPattern.retryValue[indexRedelivery],
                        //                 "x-redelivery": Number(indexRedelivery) + 1,
                        //             }
                        //         });
                        //
                        //         channel.ack(message)
                        //         return;
                        //     }
                        //
                        //     // Dead letter Exchange and its queue
                        //     // this.assertExchange(channel, exchangeDLX,'direct', {
                        //     //     durable: true,
                        //     // });
                        //
                        //     // Queue binding to the exchange
                        //     // await channel.bindQueue(queueDeclared, exchangeDelay);
                        //     // await channel.bindQueue(queueDeclared, exchangeDLX, routingKeyDLX);
                        // }

                        // Move to Error queue
                        await this.checkQueueAndAssert(queueDeclared, () => {
                            this.channelList[queueName].sendToQueue(`${queueDeclared}_error`,  Buffer.from(JSON.stringify({
                                headers: message.properties.headers,
                                message: jsonMsg,
                                host: this.getSystemInfo(),
                                error: {
                                    stack: err.stack,
                                    message: err.message,
                                },
                            }), "utf-8"));
                        }, {
                            suffix: "_error"
                        })

                        channel.ack(message)

                    },
                    complete: () => {
                        // Logger.log(`Completed consumer message ${bindConsume.consumer.name}, time: ${performance.now() - start}ms`)
                    }
                });

            }, {
                noAck: false,
            }).then((r) => {
            });
        }, {
            exchange: {
                name: exchange,
                type: 'fanout',
            }
        })
    }

    private async checkQueueAndAssert(queueName: string, callback, options?: { exchange?: { name: string, type: string }, suffix? : string }) {
        this.channelList[queueName].assertQueue(`${queueName}${options?.suffix??''}`, {
            durable: true
        }).then(async () => {
            if (options.exchange) {
                await this.channelList[queueName].bindQueue(queueName, this.getNameAddClusterPrefix(options.exchange?.name), '')
            }
            callback();
        })
    }

    private async assertExchange(channel, exchangeName: string, type: string, options: any = {
    }) {
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
            processId: process.pid,    // Thay thế bằng version assembly thực tế của bạn (nếu có)
            frameworkVersion: process.version, // Thay thế bằng version MassTransit thực tế của bạn (nếu có)
            operatingSystemVersion: `${os.type()} ${os.release()}`
        };
    }

    public close() {}

    protected getNameAddClusterPrefix(name) {
        const _name = `${this.brokerConfig.brokerName ? `${this.brokerConfig.brokerName}:` : '' }${name}`;
        return _name;
    }

    // Message functions
    async publish<TMessage>(message: TMessage, ctx?: BehaviorContext<any, TMessage>) {
        // Trường hợp Message không có exchange trong process thì push thẳng vào tên exchange ??
        let exchange = this.getNameAddClusterPrefix(this.classMessageToExchange[message.constructor.name] ?? message.constructor.name);
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
        } as IMessage<any>
        (await this.getProducerChannel()).publish(exchange, '', Buffer.from(JSON.stringify(msg), "utf-8"), {
            persistent: true,
        });
    }

    /* Bản chất rabbitmq không thể async khi publish được, sử dụng sendQueue instead */
    async publishAsync<TMessage>(message: TMessage, ctx?: BehaviorContext<any, TMessage>): Promise<any> {
        const endpoint = this.classMessageToEndpoint[message.constructor.name];
        const correlationId = uuidv7();
        const replyQueueName = 'amq.rabbitmq.reply-to';
        const timeout = 10000;

        let channelTemp = await this.connection.createChannel();

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
                            channelTemp.cancel(consumeResult.consumerTag).catch(e => console.error("Failed to cancel consumer", e)); // Hủy consumer
                        }
                    }
                },
                { noAck: true }
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
                    destinationAddress: `rabbitmq://${this.brokerConfig.brokerInfo.host}/queue/${endpoint.Name ?? ''}`,
                    messageType: `message:${this.brokerConfig.brokerName}:${message.constructor.name}`,
                    message: message,
                    sentTime: new Date().toString(),
                    expirationTime: addMilliseconds(new Date(), timeout).toString(),
                    headers: {
                        saga: ctx?.Saga,
                    },
                } as IMessage<any>

                channelTemp.publish('', endpoint.Name, Buffer.from(JSON.stringify(msg), "utf-8"), {
                    replyTo: replyQueueName,
                    correlationId: correlationId,
                    persistent: true,
                });

                Logger.debug(`[x] Sent msg to ${endpoint.Name} with MSG ${JSON.stringify(msg)}, replyTo ${replyQueueName}`);
            } catch (error) {
                clearTimeout(timer);
                reject(error);
                channelTemp.cancel(consumeResult.consumerTag).catch(e => console.error("Failed to cancel consumer", e));
            } finally {
            }
        });
    }
}