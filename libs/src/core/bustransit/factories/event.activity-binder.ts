import {BehaviorContext} from "@core/bustransit/factories/behavior.context";
import {SagaState} from "@core/bustransit/factories/saga.state";
import {IEventActivityBinder} from "@core/bustransit/interfaces/event.activity-binder.interface";
import {IBehaviorContext} from "@core/bustransit/interfaces/behavior.context.interface";
import {Logger} from "@nestjs/common";
import {BusTransitStateMachine} from "@core/bustransit/factories/saga.bustransit.state-machine";

export class EventActivityBinder<TState extends object, TEvent> implements IEventActivityBinder<TState, TEvent> {
    private stateClass: BusTransitStateMachine<any>;
    private eventClass: { new(...args: any[]): TEvent };
    private previousStates = {};

    private stepThen: (c: BehaviorContext<TState, TEvent>) => void;
    private publishAsync: (c: IBehaviorContext<TState, TEvent>) => any;
    private transitionTo: (c: SagaState<any>) => any;
    private finalize: any;

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

    TransitionTo(c: (c: IState) => void): IEventActivityBinder<TState, TEvent> {
        this.transitionTo = c;
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