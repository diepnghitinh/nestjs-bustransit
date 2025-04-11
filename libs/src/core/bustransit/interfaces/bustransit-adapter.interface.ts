import { BusTransitModuleOptionsRabbitMq_Host_Factory } from "../factories/bustransit-options";

export interface IBusTransitAdapterAuthConfig {
    Username(username: string): void;
    Password(password: string): void;
    getOptions(): any;
}

export interface IBusTransitAdapterConfig {
}

export interface IRabbitMqBusFactoryConfigurator extends IBusTransitAdapterConfig {
    Host(host: string, vhost: string, h: BusTransitModuleOptionsRabbitMq_Host_Factory): void;
    ReceiveEndpoint(queueName: string, e: any): void;
    set PrefetchCount(value: number);
    set Durable(value: boolean);
    getOptions(): any;
}