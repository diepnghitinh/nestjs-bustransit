import {BusTransitConsumer} from "@core/bustransit/factories/consumer";

export interface IAddBusTransit {
    UsingRabbitMq(configure: (ctx, x: IRabbitMqBusFactoryConfigurator) => void);
    AddConsumer<T extends BusTransitConsumer<any>, E>(consumerClass: new (...args: any[]) => T, consumerDefinition?: E): void;
}