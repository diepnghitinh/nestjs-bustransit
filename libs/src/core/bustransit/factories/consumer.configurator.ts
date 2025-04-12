import {Logger} from "@nestjs/common";

export class ConsumerConfigurator implements IConsumerConfigurator {
    UseMessageRetry() {
        Logger.debug('UseMessageRetry');
    }
}