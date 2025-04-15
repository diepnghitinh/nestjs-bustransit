import * as amqp from 'amqplib';

import {IBusTransitBrokerOptions} from "@core/bustransit/interfaces/brokers/bustransit-broker.options.interface";
import {BusTransitBrokerBaseFactory} from "@core/bustransit/factories/brokers/bustransit-broker.base";
import {Inject, Injectable, Logger, ParamData} from "@nestjs/common";
import {ConsumerConfigurator} from "@core/bustransit/factories/consumer.configurator";
import * as os from "os";

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
            Logger.debug('Started Consumer ');

            await this.createChannel(queueName, options);
            this.bindConsumerToQueue(consumer, queueName);
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
        consumer: Function,
        queueName: string
    ) {
        this.checkQueueAndAssert(queueName,() => {
            let channel = this.channelList[queueName];
            channel.consume(queueName, (message) => {
                try {
                    const consumerInstance = this.moduleRef.get(consumer);
                    consumerInstance.Consume(message);
                } catch (e) {
                    // Move to Error queue
                    let queueError = `${queueName}`;
                    this.checkQueueAndAssert(queueError, () => {
                        this.sendToQueueWithChannel(this.channelList[queueName], `${queueError}_error`, {
                            headers: message.properties.headers,
                            message: JSON.parse(message.content.toString()),
                            host: this.getSystemInfo()
                        } as IErrorMessage);
                    }, {
                        suffix: "_error",
                    })

                    // Move to skip queue

                    Logger.error(e);

                } finally {
                    channel.ack(message)
                }

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
            durable: true,
        }).then(() => {
            callback();
        })
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