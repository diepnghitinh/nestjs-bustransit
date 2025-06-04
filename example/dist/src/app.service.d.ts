import { IPublishEndpoint } from "nestjs-bustransit";
export declare class AppService {
    private readonly publishEndpoint;
    constructor(publishEndpoint: IPublishEndpoint);
    testConsumer(): void;
    testSaga(): Promise<any>;
}
