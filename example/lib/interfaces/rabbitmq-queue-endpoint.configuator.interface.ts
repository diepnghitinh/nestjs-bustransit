import {IRabbitMqQueueConfigurator} from "./rabbitmq-queue.configurator";

export interface IRabbitMqQueueEndpointConfigurator extends IRabbitMqQueueConfigurator {
    /// <summary>
    /// Purge the messages from an existing queue on startup (note that upon reconnection to the server
    /// the queue will not be purged again, only when the service is restarted).
    /// </summary>
    PurgeOnStartup: boolean;
}