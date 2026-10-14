import {BehaviorContext} from "../factories/behavior.context";
import {IPublishOptions} from "./publisher-options.interface";

export abstract class IPublishEndpoint {
    /**
     * Publish to the message's exchange. Resolves once the message is handed to the broker;
     * with publisher confirms enabled, resolves only after the broker acks (after retries).
     */
    Publish: <T>(message: T, ctx?: BehaviorContext<any, T>, options?: IPublishOptions) => Promise<void>;
    Send: <T>(message: T, ctx?: BehaviorContext<any, T>) => Promise<any>;
}
