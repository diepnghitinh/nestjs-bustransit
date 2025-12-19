import {Logger} from "@nestjs/common";
import {RabbitmqHostSettings} from "./rabbitmq-host.settings";
import {BrokerEnum} from "../interfaces/enums";
import {RabbitMqReceiveEndpointConfigurator} from "./rabbitmq-receive-endpoint.configuator";
import {IBusTransitBrokerOptions} from "../interfaces/brokers/bustransit-broker.options.interface";
import {IRabbitmqHostSettings} from "../interfaces/rabbitmq-host.settings.interface";
import {IRabbitMqBusFactoryConfigurator} from "../interfaces/rabbitmq-bus-factory.configurator.interface";
import {IRabbitMqReceiveEndpointConfigurator} from "../interfaces/rabbitmq-receive-endpoint.configuator.interface";

export class RabbitMqBusFactoryConfigurator implements IRabbitMqBusFactoryConfigurator
{
    private prefetchCount: number = 50;

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

    public setClusterName(name) {
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
        rabbitMqReceiveEndpointConfigurator.PrefetchCount = this.prefetchCount;
        e(rabbitMqReceiveEndpointConfigurator);
    }

    ConfigureEndpoints(ctx): void {
        console.log(ctx);
    }

    getOptions() {
        return this.options;
    }
}