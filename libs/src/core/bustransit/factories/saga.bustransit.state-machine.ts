import {IBusTransitStateMachine} from "@core/bustransit/interfaces/saga.bustransit.state-machine.interface";

export class BusTransitStateMachine<T> implements IBusTransitStateMachine {
    private _correlationId: string;
    private _currentState: string;

    get CurrentState(): string {
        return this._currentState;
    }
    set CurrentState(value: string) {
        this._currentState = value;
    }

    get CorrelationId(): string {
        return this._currentState;
    }
    set CorrelationId(value: string) {
        this._currentState = value;
    }

    /*
        Xác nhận hoàn thành
     */
    SetCompletedWhenFinalized() {

    }

    Event<T>(eventClass: { new(...args: any[]): T }): void {
    }
}