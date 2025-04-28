import {BehaviorContext} from "@core/bustransit/factories/behavior.context";

export abstract class IPublishEndpoint {
    Publish: <T>(message: T, ctx?: BehaviorContext<any, T>) => void;
    Send: <T>(message: T, ctx?: BehaviorContext<any, T>) => Promise<any>;
}
