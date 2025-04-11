import {
    IBusTransitAdapterAuthConfig,
    IBusTransitAdapterConfig,
    IRabbitMqBusFactoryConfigurator
} from "../interfaces/bustransit-adapter.interface";

export type BusTransitModuleOptions_Factory = (
    context: any,
    cfg: IBusTransitAdapterConfig,
) => void;

export type BusTransitModuleOptionsRabbitMq_Factory = (
    context: any,
    cfg: IRabbitMqBusFactoryConfigurator,
) => any;

export type BusTransitModuleOptionsRabbitMq_Host_Factory = (
    h: IBusTransitAdapterAuthConfig,
) => any;