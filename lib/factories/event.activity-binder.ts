import {BehaviorContext} from "./behavior.context";
import {SagaState} from "./saga.state";
import {IEventActivityBinder} from "../interfaces/event.activity-binder.interface";
import {IBehaviorContext} from "../interfaces/behavior.context.interface";
import {Logger} from "@nestjs/common";
import {BusTransitStateMachine} from "./saga.bustransit.state-machine";
import {IState} from "../interfaces/saga";

export class EventActivityBinder<TState extends object, TEvent> implements IEventActivityBinder<TState, TEvent> {
    public stateClass: BusTransitStateMachine<any>;
    public eventClass: { new(...args: any[]): TEvent };
    public previousStates = {};

    public stepThen: (c: BehaviorContext<TState, TEvent>) => void;
    public publishAsync: (c: IBehaviorContext<TState, TEvent>) => any;
    public transitionTo: SagaState<any>;
    public finalize: any;

    constructor(whenClass: { new(...args: any[]): TEvent }) {
        this.eventClass = whenClass;
    }

    PublishAsync<TTransport>(transportClass: new (...args: any[]) => TTransport, c: (c: IBehaviorContext<TState, TEvent>) => TTransport): IEventActivityBinder<TState, TEvent> {
        this.publishAsync = c;
        this.stateClass.GetBehaviours[transportClass.name] = transportClass;
        return this;
    }

    Then(c: (c: BehaviorContext<TState, TEvent>) => void): IEventActivityBinder<TState, TEvent> {
        this.stepThen = c;
        return this;
    }

    TransitionTo(c: IState): IEventActivityBinder<TState, TEvent> {
        this.transitionTo = c as SagaState<any>;
        return this;
    }

    Finalize(): IEventActivityBinder<TState, TEvent> {
        this.finalize = () => {
            console.log('Finalize')
        }
        return this;
    }

    addPreviousState(state: IState) {
        this.previousStates[(state as SagaState<any>).Name] = state;
    }

    getEventClass() {
        return this.eventClass;
    }

    setStateClass(stateClass: BusTransitStateMachine<any>) {
        this.stateClass = stateClass;
    }
}