import {IRabbitmqHostSettings} from "./rabbitmq-host.settings.interface";
import {IRabbitMqReceiveEndpointConfigurator} from "./rabbitmq-receive-endpoint.configuator.interface";
import {IRabbitMqQueueEndpointConfigurator} from "./rabbitmq-queue-endpoint.configuator.interface";
import {IBusFactoryConfigurator} from "./bus-factory.configurator.interface";
import {IRetryConfigurator} from "./retry.configurator.interface";

export interface IRabbitMqBusFactoryConfigurator extends IBusFactoryConfigurator<IRabbitMqReceiveEndpointConfigurator>, IRabbitMqQueueEndpointConfigurator {
    setClusterName(name: string);
    Send<T>();
    Publish<T>();
    /**
     * Wait for the broker to confirm every Publish (RabbitMQ publisher confirms).
     * @param timeoutMs max wait for a confirm before the attempt fails (default 5000)
     */
    UsePublisherConfirms(timeoutMs?: number): void;
    /**
     * Retry a failed Publish (channel closed, nack, confirm timeout) with the given policy.
     * A message is re-sent with the same messageId, so delivery is at-least-once: consumers must be idempotent.
     */
    UsePublishRetry(c: (c: IRetryConfigurator) => void): void;
    Host(host: string, vhost: string, h: (h: IRabbitmqHostSettings) => void): void;
}