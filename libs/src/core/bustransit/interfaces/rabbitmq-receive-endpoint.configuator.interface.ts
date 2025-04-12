/// <summary>
/// Configure a receiving RabbitMQ endpoint
/// </summary>

interface IRabbitMqReceiveEndpointConfigurator extends
    IReceiveEndpointConfigurator, IRabbitMqQueueEndpointConfigurator
{}