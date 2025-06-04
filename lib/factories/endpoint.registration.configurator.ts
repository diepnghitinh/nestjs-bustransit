import {
    IEndpointRegistrationConfigurator
} from "../interfaces/endpoint.registration.configurator.interface";

export class EndpointRegistrationConfigurator implements IEndpointRegistrationConfigurator {
    Name: string;
    PrefetchCount: number;
}