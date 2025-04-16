import {Logger} from "@nestjs/common";
import {RetryConfigurator} from "@core/bustransit/factories/retry.configurator";
import {interval, mergeMap, of, retry, throwError} from "rxjs";

export class ConsumerConfigurator implements IConsumerConfigurator {
    private queueName: string;
    private _consumer: Function;
    private _options: {};
    private _retryPattern: any;

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

    get retryPattern() {
        return this._retryPattern;
    }

    UseDelayedRedelivery(c: (c: IRetryConfigurator) => void) {
        const retryConfigurator = new RetryConfigurator();
        const retryResult = c(retryConfigurator);
        this._retryPattern = retryConfigurator.getRetryValue();
        return retryResult;
    }

    UseMessageRetry(c: (c: IRetryConfigurator) => void) {
        const retryConfigurator = new RetryConfigurator();
        const retryResult = c(retryConfigurator);
        this._retryPattern = retryConfigurator.getRetryValue();
        return retryResult;
    }
}