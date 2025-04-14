export abstract class IPublishEndpoint {
    Publish: <T>(message: T) => void;
}