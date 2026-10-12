export interface Deferred<T> {
    readonly promise: Promise<T>;
    readonly settled: boolean;
    resolve(value: T): void;
}

export function createDeferred<T = void>(): Deferred<T> {
    let resolveFn!: (value: T) => void;
    let settled = false;
    const promise = new Promise<T>((resolve) => {
        resolveFn = resolve;
    });
    return {
        promise,
        get settled() {
            return settled;
        },
        resolve(value: T) {
            if (settled) return;
            settled = true;
            resolveFn(value);
        },
    };
}

export function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), ms);
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
