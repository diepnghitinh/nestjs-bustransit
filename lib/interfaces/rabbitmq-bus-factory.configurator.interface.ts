import {IRabbitmqHostSettings} from "./rabbitmq-host.settings.interface";
import {IRabbitMqReceiveEndpointConfigurator} from "./rabbitmq-receive-endpoint.configuator.interface";
import {IRabbitMqQueueEndpointConfigurator} from "./rabbitmq-queue-endpoint.configuator.interface";
import type {ReliabilityOptions} from "../factories/brokers/rabbitmq/reliability-options";
import {IBusFactoryConfigurator} from "./bus-factory.configurator.interface";

export interface IRabbitMqBusFactoryConfigurator extends IBusFactoryConfigurator<IRabbitMqReceiveEndpointConfigurator>, IRabbitMqQueueEndpointConfigurator {
    setClusterName(name: string);
    Send<T>();
    Publish<T>();
    UseReliability(options: Partial<ReliabilityOptions>): void;
    Host(host: string, vhost: string, h: (h: IRabbitmqHostSettings) => void): void;
}