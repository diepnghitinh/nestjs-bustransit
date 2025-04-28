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
                        return throwError(error);
                    }
                    const tryAfter = delay * scalingFactor ** (retryAttempts - 1);

                    Logger.log(`Attempt ${retryAttempts}: retrying in ${tryAfter}ms`);
                    // retry after 1s, 2s, etc...
                    return timer(tryAfter);
                }),
                finalize(() => Logger.log('Done with retrying.'))
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
    let retryAttempts = 0; // Biến đếm số lần thử lại
    return source$.pipe(
        retryWhen((attempts: Observable<any>) => {
            return attempts.pipe(
                switchMap((error) => {
                    // if maximum number of retries have been met
                    // or response is a status code we don't wish to retry, throw error
                    if (intervals.length > 0 && retryAttempts >= intervals.length) {
                        return throwError(error);
                    }
                    const tryAfter = intervals.length > 0 ? intervals[retryAttempts] : 0;;

                    retryAttempts++;
                    Logger.log(`Attempt ${retryAttempts}: retrying after ${tryAfter}ms at ${new Date()}`);
                    // retry after 1s, 2s, etc...
                    return timer(tryAfter);
                }),
                finalize(() => Logger.log('Done with retrying.'))
            );
        }),
        tap(() => {
            retryAttempts = 0;
        })


        // retryWhen(errors =>
        //     errors.pipe(
        //         tap(err => {
        //             if (intervals.length > 0 && retryAttempts >= intervals.length) {
        //                 throw err; // Nếu đã thử lại hết số lần quy định, ném lỗi
        //             }
        //             const delayTime = intervals.length > 0 ? intervals[retryAttempts % intervals.length] : 0;
        //             console.log(`Try after ${delayTime}ms... (Attempt ${retryAttempts + 1})`);
        //             retryAttempts++;
        //         }),
        //         delayWhen(() => timer(intervals.length > 0 ? intervals[retryAttempts - 1] : 0)) // Sử dụng retryCount - 1 để lấy khoảng thời gian trước đó
        //     )
        // )
    );
}