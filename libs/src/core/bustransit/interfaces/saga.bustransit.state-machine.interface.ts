export interface IBusTransitStateMachine {
    Event<T>(eventClass: new (...args: any[]) => T): void;
}