import {IBehaviorContext} from "@core/bustransit/interfaces/behavior.context.interface";

export interface IEventActivityBinder<TState extends object, TMessage> {
    Then(c: (c: IBehaviorContext<TState, TMessage>) => void): IEventActivityBinder<TState, TMessage>;
    PublishAsync<TTransport>(transportClass: new (...args: any[]) => TTransport, c: (c: IBehaviorContext<TState, TMessage>) => TTransport): IEventActivityBinder<TState, TMessage>;
    TransitionTo(c: IState): IEventActivityBinder<TState, TMessage>;
    Finalize(): IEventActivityBinder<TState, TMessage>;
}