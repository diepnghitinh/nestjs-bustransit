import {
    catchError,
    concat,
    defer,
    delay,
    finalize,
    interval,
    mergeMap,
    Observable,
    of,
    retry,
    retryWhen, switchMap,
    take,
    tap,
    throwError, timer
} from "rxjs";
import {retryWithDelay, retryWithIntervals} from "./retry.utils";
import {IRetryConfigurator} from "../interfaces/retry.configurator.interface";

export enum RetryLevel {
    retry,
    redelivery,
}

export enum Retry {
    Immediate,
    Interval,
    Intervals
}

export class RetryConfigurator implements IRetryConfigurator {

    private retryType: Retry;
    private retryValue: any;
    private type;

    constructor(type: RetryLevel) {
        this.type = type;
    }

    Immediate(retryCount: number) {
        this.retryType = Retry.Immediate;
        this.retryValue = retryCount;
    }

    Interval(retryCount: number, delay: number) {
        this.retryType = Retry.Interval;
        this.retryValue = [retryCount, delay];
    }

    Intervals(...delays: number[]) {
        this.retryType = Retry.Intervals;
        this.retryValue = delays;
    }

    getRetryValue() {
        switch (this.retryType) {
            case Retry.Interval:
                return {
                    retryType: this.retryType,
                    retryValue: this.retryValue,
                }
            case Retry.Intervals:
                return {
                    retryType: this.retryType,
                    retryValue: this.retryValue,
                    pipe: retryWithIntervals(this.retryValue)
                };
            case Retry.Immediate:
            default:
                return {
                    retryType: this.retryType,
                    retryValue: this.retryValue,
                    pipe: retryWithDelay({ maxRetryAttempts: this.retryValue, delay: 0 })
                };
        }
        return null;
    }

}

