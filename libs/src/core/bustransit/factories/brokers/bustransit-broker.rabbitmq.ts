import * as amqp from 'amqplib';
import {IBusTransitBrokerOptions} from "@core/bustransit/interfaces/brokers/bustransit-broker.options.interface";
import {BusTransitBrokerBaseFactory} from "@core/bustransit/factories/brokers/bustransit-broker.base";
import {Logger} from "@nestjs/common";

export class BusTransitBrokerRabbitMqFactory extends BusTransitBrokerBaseFactory
{
    brokerName = "RabbitMq"
    brokerConfig: IBusTransitBrokerOptions;

    private connection: amqp.ChannelModel;
    private channel: amqp.Channel;

    public async start() {
        const brokerInfo = this.brokerConfig.brokerInfo;

        const connectString = `amqp://${brokerInfo['username']}:${brokerInfo['password']}@${brokerInfo['host']}:${brokerInfo['port']}${brokerInfo['vhost']}`;

        this.connection = await amqp.connect(connectString, {clientProperties: {connection_name: this.brokerConfig.brokerName}});
        this.channel = await this.connection.createChannel();

        this.startAllConsumer();
    }

    public setBrokerConfig(brokerConfig: IBusTransitBrokerOptions) {
        this.brokerConfig = brokerConfig;
    }

    public startAllConsumer()  {
        Object.entries( this.consumers ).map((key, value) => {

            let consumerName = key[0];
            Logger.debug('Started Consumer ' + key[0]);
            Logger.debug(this.consumers)
            Logger.debug(this.consumersBindQueue)

            let findConsumersBindQueue = this.consumersBindQueue[consumerName]
            this.bindConsumerToQueue(consumerName, findConsumersBindQueue);

        })
    }

    protected bindConsumerToQueue(consumerName: string, queueName: string) {

        this.checkQueueAndAssert(queueName,() => {
            this.channel.consume(queueName, this.consumers[consumerName].Consume).then((r) => {

            });
        })


    }

    private checkQueueAndAssert(queueName: string, callback) {
        this.channel.assertQueue(queueName, {
            durable: true,
        }).then(() => {
            callback();
        })
    }

    public close() {

    }
}