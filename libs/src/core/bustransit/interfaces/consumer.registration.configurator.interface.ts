import {
    IEndpointRegistrationConfigurator
} from "@core/bustransit/interfaces/endpoint.registration.configurator.interface";

export interface IConsumerRegistrationConfigurator<TConsumer> {
    Endpoint(c: (c: IEndpointRegistrationConfigurator) => void);
}