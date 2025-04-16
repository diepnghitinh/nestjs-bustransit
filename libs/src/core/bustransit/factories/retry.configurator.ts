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
import {retryWithDelay} from "@core/bustransit/factories/retry.utils";

enum Retry {
    Immediate,
    Interval,
    Intervals
}

export class RetryConfigurator implements IRetryConfigurator {

    private retryType: Retry;
    private retryValue: any;

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
                break;
            case Retry.Intervals:
                break;
            case Retry.Immediate:
            default:
                return retryWithDelay({ maxRetryAttempts: this.retryValue, delay: 0 });
        }
        return null;
    }

}

