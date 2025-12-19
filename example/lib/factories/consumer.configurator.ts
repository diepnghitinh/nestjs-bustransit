import {RetryConfigurator, RetryLevel} from "./retry.configurator";
import {IRetryConfigurator} from "../interfaces/retry.configurator.interface";
import {IConsumerConfigurator} from "../interfaces/consumer.configurator.interface";

export class ConsumerConfigurator implements IConsumerConfigurator {
    private queueName: string;
    private _consumer: Function;
    private _options: {};
    private _retryPattern: any;
    private _redeliveryPattern: any;

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

    get consumer(): Function {
        return this._consumer;
    }

    get retryPattern() {
        return this._retryPattern;
    }

    get redeliveryPattern() {
        return this._redeliveryPattern;
    }

    UseDelayedRedelivery(c: (c: IRetryConfigurator) => void) {
        const retryConfigurator = new RetryConfigurator(RetryLevel.redelivery);
        const retryResult = c(retryConfigurator);
        this._redeliveryPattern = retryConfigurator.getRetryValue();
        return retryResult;
    }

    UseMessageRetry(c: (c: IRetryConfigurator) => void) {
        const retryConfigurator = new RetryConfigurator(RetryLevel.retry);
        const retryResult = c(retryConfigurator);
        this._retryPattern = retryConfigurator.getRetryValue();
        return retryResult;
    }
}