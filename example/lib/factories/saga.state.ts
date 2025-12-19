import {IState} from "../interfaces/saga";

export class SagaState<TState> implements IState {

    Name: string;

    constructor(name: string) {
        this.Name = name;
    }
}