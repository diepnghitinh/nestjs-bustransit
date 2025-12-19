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
    Intervals,
    Exponential
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

    Exponential(retryCount: number, initialDelay: number = 1000, scalingFactor: number = 2) {
        this.retryType = Retry.Exponential;
        this.retryValue = [retryCount, initialDelay, scalingFactor];
    }

    getRetryValue() {
        switch (this.retryType) {
            case Retry.Interval:
                return {
                    retryType: this.retryType,
                    retryValue: this.retryValue,
                    pipe: retryWithDelay({
                        maxRetryAttempts: this.retryValue[0],
                        delay: this.retryValue[1],
                        scalingFactor: 1
                    })
                }
            case Retry.Intervals:
                return {
                    retryType: this.retryType,
                    retryValue: this.retryValue,
                    pipe: retryWithIntervals(this.retryValue)
                };
            case Retry.Exponential:
                return {
                    retryType: this.retryType,
                    retryValue: this.retryValue,
                    pipe: retryWithDelay({
                        maxRetryAttempts: this.retryValue[0],
                        delay: this.retryValue[1],
                        scalingFactor: this.retryValue[2]
                    })
                };
            case Retry.Immediate:
            default:
                return {
                    retryType: this.retryType,
                    retryValue: this.retryValue,
                    pipe: retryWithDelay({ maxRetryAttempts: this.retryValue, delay: 0 })
                };
        }
    }

}

