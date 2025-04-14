import {IPublishEndpoint} from "@core/bustransit/interfaces/publish-endpoint.interface";
import {Injectable, Logger} from "@nestjs/common";

@Injectable()
export class PublishEndpoint implements IPublishEndpoint {
    Publish<T>(message: T) {
        Logger.verbose(message)
    }
}