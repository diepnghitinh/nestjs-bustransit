import {Logger} from "@nestjs/common";

export class ConsumerConfigurator implements IConsumerConfigurator {
    private queueName: string;
    private consumer: Function;

    UseMessageRetry() {
        Logger.debug('UseMessageRetry');
    }

    bindQueue(queueName: string) {
        this.queueName = queueName;
    }

    bindConsumer(consumer: Function) {
        this.consumer = consumer;
    }
}