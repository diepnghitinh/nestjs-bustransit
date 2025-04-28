import {
    IConsumerRegistrationConfigurator
} from "@core/bustransit/interfaces/consumer.registration.configurator.interface";
import {
    IEndpointRegistrationConfigurator
} from "@core/bustransit/interfaces/endpoint.registration.configurator.interface";
import {EndpointRegistrationConfigurator} from "@core/bustransit/factories/endpoint.registration.configurator";

export class ConsumerRegistrationConfigurator<TConsumer> implements IConsumerRegistrationConfigurator<TConsumer> {

    private consumerClass;
    private endpointRegistrationConfigurator: EndpointRegistrationConfigurator;

    constructor(consumerClass: new (...args: any[]) => TConsumer) {
        this.consumerClass = consumerClass;
    }

    Endpoint(c: (c: IEndpointRegistrationConfigurator) => void) {
        this.endpointRegistrationConfigurator = new EndpointRegistrationConfigurator();
        c(this.endpointRegistrationConfigurator);
        this.consumerClass.EndpointRegistrationConfigurator = this.endpointRegistrationConfigurator;
    }

    get EndpointRegistrationConfigurator() {
        return this.endpointRegistrationConfigurator;
    }
}