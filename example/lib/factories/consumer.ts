import {IBusTransitConsumer, IConsumeContext} from "../interfaces/consumer.interface";
import {parseClassAndValidate} from "./bustransit.utils";
import {PublishEndpoint} from "./publish-endpoint";
import {
    IEndpointRegistrationConfigurator
} from "../interfaces/endpoint.registration.configurator.interface";
import {BehaviorContext} from "./behavior.context";

export abstract class BusTransitConsumer<TMessage extends object> implements IBusTransitConsumer<TMessage> {

    protected message;
    private _publishEndpoint: PublishEndpoint;
    private endpointRegistrationConfigurator;

    get GetMessageClass() {
        return this.message
    };

    protected constructor(messageClass: new (...args: any[]) => TMessage) {
        this.message = messageClass;
    }

    async Consume(ctx: BehaviorContext<any, TMessage>, context: IConsumeContext<TMessage>) {
        const msg = await this.getMessage(context)
        context.Message = msg;
        context.messageType = msg.constructor.name;
    }

    set producer(publishEndpoint) {
        this._publishEndpoint = publishEndpoint;
    }

    get producer() {
        return this._publishEndpoint;
    }

    set EndpointRegistrationConfigurator(endpointRegistrationConfigurator: IEndpointRegistrationConfigurator) {
        this.endpointRegistrationConfigurator = endpointRegistrationConfigurator;
    }

    get EndpointRegistrationConfigurator() {
        return this.endpointRegistrationConfigurator;
    }

    async getMessage(context: IConsumeContext<TMessage>): Promise<TMessage> {
        return await parseClassAndValidate(this.message, context.Message);
    }

    getExchange(exchange: string) {
        return exchange.split(':')[1];
    }
}