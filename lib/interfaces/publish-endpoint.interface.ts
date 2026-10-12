import {BehaviorContext} from "../factories/behavior.context";

export abstract class IPublishEndpoint {
    Publish: <T>(message: T, ctx?: BehaviorContext<any, T>) => Promise<void>;
    Send: <T>(message: T, ctx?: BehaviorContext<any, T>) => Promise<any>;
}
