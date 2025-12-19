import {
    IEndpointRegistrationConfigurator
} from "./endpoint.registration.configurator.interface";

export interface IConsumerRegistrationConfigurator<TConsumer> {
    Endpoint(c: (c: IEndpointRegistrationConfigurator) => void);
}