import {Logger} from "@nestjs/common";

export class ConsumerConfigurator implements IConsumerConfigurator {
    private queueName: string;
    private _consumer: Function;
    private _options: {};

    UseMessageRetry() {
        Logger.debug('UseMessageRetry');
    }

    bindQueue(queueName: string) {
        this.queueName = queueName;
    }

    bindConsumer(consumer: Function, options?: {}) {
        this._consumer = consumer;
    }

    setOptions(options) {
        this._options = options;
    }

    get options() {
        return this._options;
    }

    get consumer() {
        return this._consumer;
    }
}