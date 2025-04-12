import {Logger} from "@nestjs/common";
import {RabbitmqHostSettings} from "@core/bustransit/factories/rabbitmq-host.settings";
import {BrokerEnum} from "@core/bustransit/interfaces/enums";
import {RabbitMqReceiveEndpointConfigurator} from "@core/bustransit/factories/rabbitmq-receive-endpoint.configuator";
import {IBusTransitBrokerOptions} from "@core/bustransit/interfaces/brokers/bustransit-broker.options.interface";

export class RabbitMqBusFactoryConfigurator implements IRabbitMqBusFactoryConfigurator
{
    private prefetchCount: number = 50;
    private durable: boolean = true;
    private options: IBusTransitBrokerOptions = {
        brokerName: '',
        brokerType: '',
        brokerInfo: {
            host: '',
            vhost: '',
            username: '',
            password: '',
            port: 5672
        }
    }

    public setName(name) {
        this.options.brokerName = name;
    }

    public Host(host: string, vhost: string, h: (h: IRabbitmqHostSettings) => void): any {
        const rabbitmqHostSettings = new RabbitmqHostSettings();
        h(rabbitmqHostSettings);
        this.options = {
            ...this.options,
            brokerType: BrokerEnum.RABBITMQ,
            brokerInfo: {
                host: host,
                vhost: vhost,
                port: 5672,
                ...rabbitmqHostSettings.getOptions(),
            }
        }
    }

    Publish<T>() {
    }

    Send<T>() {
    }

    SetExchangeArgument(key: string, value: any) {
    }

    set PrefetchCount(value: number) {
        this.prefetchCount = value;
    }

    AutoDelete: boolean;
    Durable: boolean;
    ExchangeType: string;
    PurgeOnStartup: boolean;

    ReceiveEndpoint(queueName: string, e: (e: IRabbitMqReceiveEndpointConfigurator) => void): void {
        const rabbitMqReceiveEndpointConfigurator = new RabbitMqReceiveEndpointConfigurator();
        rabbitMqReceiveEndpointConfigurator.QueueName = queueName;
        e(rabbitMqReceiveEndpointConfigurator);
    }

    getOptions() {
        return this.options;
    }
}