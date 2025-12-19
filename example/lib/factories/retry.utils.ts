import {finalize, Observable, retryWhen, delayWhen, switchMap, tap, throwError, timer} from "rxjs";
import {Logger} from "@nestjs/common";

export interface IRetryStratetyConfig {
    /**
     * A delay in miliseconds. Default set to 1000ms
     */
    delay?: number;
    /**
     * Number of maximum attempts.
     */
    maxRetryAttempts?: number;
    /**
     * Factor by whitch the next delay will be multiplied. Default set to 1
     */
    scalingFactor?: number;
    /**
     * List of HTTP codes to be excluded from retrying.
     */
    excludedStatusCodes?: number[];

    /**
     * If true, retry count is being resetted after every successful emission (i.e. successful reconection to the server).
     *
     * Default: false
     */
    resetRetryCountOnEmission?: boolean;
}

export const retryWithDelay = ({
                            delay = 1000,
                            maxRetryAttempts = 3,
                            scalingFactor = 1,
                            excludedStatusCodes = [],
                            resetRetryCountOnEmission = false
                        }: IRetryStratetyConfig) => <T>(source: Observable<T>) => {
    let retryAttempts = 0;
    return source.pipe(
        retryWhen((attempts: Observable<any>) => {
            return attempts.pipe(
                switchMap((error) => {
                    // if maximum number of retries have been met
                    // or response is a status code we don't wish to retry, throw error
                    if (++retryAttempts > maxRetryAttempts || excludedStatusCodes.find((e) => e === error.status)) {
                        Logger.warn(`Retry: Max attempts (${maxRetryAttempts}) reached. Giving up.`);
                        return throwError(error);
                    }
                    const tryAfter = delay * scalingFactor ** (retryAttempts - 1);

                    Logger.log(`Retry: Attempt ${retryAttempts}/${maxRetryAttempts}: retrying in ${tryAfter}ms`);
                    // retry after 1s, 2s, etc...
                    return timer(tryAfter);
                }),
                finalize(() => {
                    if (retryAttempts > 0) {
                        Logger.verbose(`Retry cycle completed after ${retryAttempts} attempts`);
                    }
                })
            );
        }),
        tap(() => {
            if (resetRetryCountOnEmission) {
                retryAttempts = 0;
            }
        })
    );
};

export const retryWithIntervals = <T>(intervals: number[]) => <T>(source$: Observable<T>) => {
    let retryAttempts = 0;
    const maxAttempts = intervals.length;

    return source$.pipe(
        retryWhen((attempts: Observable<any>) => {
            return attempts.pipe(
                switchMap((error) => {
                    // if maximum number of retries have been met, throw error
                    if (retryAttempts >= maxAttempts) {
                        Logger.warn(`Retry: Max attempts (${maxAttempts}) reached. Giving up.`);
                        return throwError(error);
                    }

                    const tryAfter = intervals[retryAttempts] ?? 0;
                    retryAttempts++;

                    Logger.log(`Retry: Attempt ${retryAttempts}/${maxAttempts}: retrying after ${tryAfter}ms`);
                    return timer(tryAfter);
                }),
                finalize(() => {
                    if (retryAttempts > 0) {
                        Logger.verbose(`Retry cycle completed after ${retryAttempts} attempts`);
                    }
                })
            );
        }),
        tap(() => {
            retryAttempts = 0;
        })
    );
}