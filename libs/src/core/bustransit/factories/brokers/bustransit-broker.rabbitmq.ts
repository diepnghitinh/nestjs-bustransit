import * as amqp from 'amqplib';

import {IBusTransitBrokerOptions} from "@core/bustransit/interfaces/brokers/bustransit-broker.options.interface";
import {BusTransitBrokerBaseFactory} from "@core/bustransit/factories/brokers/bustransit-broker.base";
import {Inject, Injectable, Logger, ParamData} from "@nestjs/common";
import {ConsumerConfigurator} from "@core/bustransit/factories/consumer.configurator";
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
import {IConsumeContext} from "@core/bustransit/interfaces/consumer.interface";

@Injectable()
export class BusTransitBrokerRabbitMqFactory extends BusTransitBrokerBaseFactory
{
    brokerName = "RabbitMq"
    brokerConfig: IBusTransitBrokerOptions;

    private connection: amqp.ChannelModel;
    private channelList: Map<string, amqp.Channel> = new Map<string, amqp.Channel>();

    public async start() {
        const brokerInfo = this.brokerConfig.brokerInfo;

        const connectString = `amqp://${brokerInfo['username']}:${brokerInfo['password']}@${brokerInfo['host']}:${brokerInfo['port']}${brokerInfo['vhost']}`;

        this.connection = await amqp.connect(connectString, {clientProperties: {connection_name: this.brokerConfig.brokerName}});

        await this.startAllConsumer();
    }

    public setBrokerConfig(brokerConfig: IBusTransitBrokerOptions) {
        this.brokerConfig = brokerConfig;
    }

    public async startAllConsumer()  {
        const _consumersBindQueue = Object.entries( this.consumersBindQueue );

        _consumersBindQueue.map(async (key, value) => {
            let consumer = (key[1] as ConsumerConfigurator).consumer;
            let queueName = key[0];
            let options = (key[1] as ConsumerConfigurator).options;
            let retryPattern = (key[1] as ConsumerConfigurator).retryPattern;
            let redeliveryPattern = (key[1] as ConsumerConfigurator).redeliveryPattern;

            Logger.debug(`Started Consumer ${consumer.name}`);

            await this.createChannel(queueName, options);
            this.bindConsumerToQueue({
                consumer: consumer,
                retryPattern: retryPattern,
                redeliveryPattern: redeliveryPattern,
            }, queueName);
            return true;
        });

        const results = await Promise.all(_consumersBindQueue);
    }

    protected async createChannel(queueName: string, options) {
        let channel = await this.connection.createChannel();
        await channel.prefetch(options.PrefetchCount);

        this.channelList[queueName] = channel;
    }

    protected bindConsumerToQueue(
        bindConsume: { consumer: Function, retryPattern: any, redeliveryPattern: any },
        queueName: string
    ) {
        this.checkQueueAndAssert(queueName,() => {
            let channel = this.channelList[queueName];
            channel.consume(queueName,  async (message) => {

                const jsonMsg = JSON.parse(message.content.toString());

                const consumerFunc = async (message) => {
                    const consumerInstance = this.moduleRef.get(bindConsume.consumer);
                    await consumerInstance.Consume({
                        Message: jsonMsg,
                    }); // context
                    channel.ack(message)
                }

                const retryPattern = bindConsume.retryPattern;
                const redeliveryPattern = bindConsume.redeliveryPattern;
                const start = performance.now();

                of(null).pipe(
                    mergeMap(() => {
                        return consumerFunc(message);
                    }),
                    retryPattern.pipe,
                ).subscribe({
                    next: (data) => {},
                    error: async (err) => {
                        Logger.error('Message error: ', err)

                        channel.ack(message)

                        let queueDeclared = `${queueName}`;

                        // TODO
                        if (redeliveryPattern) {
                            let delayExchange = `delayed.exchange.${queueName}`;
                            let delayRoutingKey = `delayed.routing.${queueName}`;

                            let exchangeDLX = `exchange_${queueName}_dlx`;
                            let routingKeyDLX = `routing_${queueName}_dlx`;

                            // Delayed exchange
                            this.assertExchange(channel, delayExchange,"x-delayed-message", {
                                autoDelete: false,
                                durable: true,
                                arguments: {'x-delayed-type': 'direct'}
                            });

                            // Dead letter Exchange and its queue
                            // this.assertExchange(channel, exchangeDLX,'direct', {
                            //     durable: true,
                            // });

                            // Queue binding to the exchange
                            // await channel.bindQueue(queueDeclared, exchangeDelay);
                            // await channel.bindQueue(queueDeclared, exchangeDLX, routingKeyDLX);
                        }

                        // Move to Error queue
                        console.log(  )
                        this.checkQueueAndAssert(queueDeclared, () => {
                            this.sendToQueueWithChannel(this.channelList[queueName], `${queueDeclared}_error`, {
                                headers: message.properties.headers,
                                message: jsonMsg,
                                host: this.getSystemInfo(),
                                error: {
                                    stack: err.stack,
                                    message: err.message,
                                },
                            } as IErrorMessage);
                        }, {
                            suffix: "_error",
                        })

                    },
                    complete: () => Logger.log(`Completed consumer message ${bindConsume.consumer.name}, time: ${performance.now() - start}ms`)
                });


            }, {
                noAck: false,
            }).then((r) => {
            });
        })

    }

    protected ConsumerHandler(consumer: Function) {
        return () => {
            return consumer
        }
    }

    private checkQueueAndAssert(queueName: string, callback, options?: { suffix : string }) {
        this.channelList[queueName].assertQueue(`${queueName}${options?.suffix??''}`, {
            durable: true
        }).then(() => {
            callback();
        })
    }

    private assertExchange(channel, exchangeName: string, type: string, options: any = {
    }) {
        channel.assertExchange(`${exchangeName}`, type, {
            durable: true,
            ...options,
        });
    }

    private sendToQueueWithChannel(channel, queueName: string, message: any) {
        channel.sendToQueue(queueName,  Buffer.from(JSON.stringify(message), "utf-8"));
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

    public close() {

    }
}