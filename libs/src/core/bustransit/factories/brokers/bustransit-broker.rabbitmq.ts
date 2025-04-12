import * as amqp from 'amqplib';
import {IBusTransitBrokerOptions} from "@core/bustransit/interfaces/brokers/bustransit-broker.options.interface";
import {BusTransitBrokerBaseFactory} from "@core/bustransit/factories/brokers/bustransit-broker.base";

export class BusTransitBrokerRabbitMqFactory extends BusTransitBrokerBaseFactory
{
    brokerName = "RabbitMq"
    brokerConfig: IBusTransitBrokerOptions;

    private connection: amqp.ChannelModel;
    private channel: amqp.Channel;

    public async start() {
        const brokerInfo = this.brokerConfig.brokerInfo;

        const connectString = `amqp://${brokerInfo['username']}:${brokerInfo['password']}@${brokerInfo['host']}:${brokerInfo['port']}${brokerInfo['vhost']}`;

        this.connection = await amqp.connect(connectString, {clientProperties: {connection_name: "myFriendlyName"}});
        this.channel = await this.connection.createChannel();
    }

    public setBrokerConfig(brokerConfig: IBusTransitBrokerOptions) {
        this.brokerConfig = brokerConfig;
    }
}