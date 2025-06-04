/// <summary>
/// Configure a receiving RabbitMQ endpoint
/// </summary>

import {IRabbitMqQueueEndpointConfigurator} from "./rabbitmq-queue-endpoint.configuator.interface";
import {IReceiveEndpointConfigurator} from "./receive-endpoint.configurator.interface";

export interface IRabbitMqReceiveEndpointConfigurator extends
    IReceiveEndpointConfigurator, IRabbitMqQueueEndpointConfigurator
{}