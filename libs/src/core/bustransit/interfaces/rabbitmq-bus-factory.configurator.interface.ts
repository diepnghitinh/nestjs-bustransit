interface IRabbitMqBusFactoryConfigurator extends IBusFactoryConfigurator<IRabbitMqReceiveEndpointConfigurator>, IRabbitMqQueueEndpointConfigurator {
    Send<T>();
    Publish<T>();
    Host(host: string, vhost: string, h: (h: IRabbitmqHostSettings) => void): void;
}