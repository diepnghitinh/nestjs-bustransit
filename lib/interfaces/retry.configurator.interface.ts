export interface IRetryConfigurator {
    Interval(retryCount: number, delay: number);
    Immediate(retryCount: number);
    Intervals(...delays: number[])
    getRetryValue();
}