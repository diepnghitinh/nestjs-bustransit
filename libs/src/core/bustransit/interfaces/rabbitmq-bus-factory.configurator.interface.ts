interface IRabbitMqBusFactoryConfigurator extends IBusFactoryConfigurator<IRabbitMqReceiveEndpointConfigurator>, IRabbitMqQueueEndpointConfigurator {
    setClusterName(name: string);
    Send<T>();
    Publish<T>();
    Host(host: string, vhost: string, h: (h: IRabbitmqHostSettings) => void): void;
}