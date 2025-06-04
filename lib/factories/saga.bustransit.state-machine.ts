import {IBusTransitStateMachine} from "../interfaces/saga.bustransit.state-machine.interface";
import {EventActivityBinder} from "./event.activity-binder";
import {BusTransitConsumer} from "./consumer";
import {Injectable, Logger} from "@nestjs/common";
import {SagaState} from "./saga.state";
import {BehaviorContext} from "./behavior.context";
import {IEventActivityBinder} from "../interfaces/event.activity-binder.interface";
import {IEventActivities} from "../interfaces/event.activities.interface";
import {ISagaConsumeContext} from "../interfaces/saga.consumer.interface";
import {IEventCorrelationConfigurator} from "../interfaces/event.correlation.configurator";
import {EventCorrelationConfigurator} from "./event.correlation.configurator";
import {SagaStateMachineInstance} from "./saga.state-machine-instance";
import {IEvent, IState} from "../interfaces/saga";
import {bufferToStringJson, getLastPart} from "../utils/utils";

export class BusTransitStateMachine<TState extends object> extends BusTransitConsumer<TState> implements IBusTransitStateMachine<TState>, IEventActivities<TState> {

    StateInitially = new SagaState('INITIALLY');
    StateFinalize = new SagaState('FINALIZE');

    private setCompletedWhenFinalized: boolean = false;
    private _classMessage;
    private _events = {};
    private _behaviours = {};
    private _eventsSelector = {};
    private _workflow = {}
    private _finalized;

    constructor(
        stateClass: { new(...args: any[]): TState },
    ) {
        super(stateClass);
        this._classMessage = stateClass;
    }

    get GetEvents(): any {
        return this._events;
    }
    get GetBehaviours(): any {
        return this._behaviours;
    }

    /*
        Xác nhận hoàn thành, khi Finalized
     */
    SetCompletedWhenFinalized<T>(result: (ctx:  BehaviorContext<any, T>) => void): any {
        this.setCompletedWhenFinalized = true;
        this._finalized = result;
    }

    Event<T>(eventClass: IEvent<T>, selector: (selector: IEventCorrelationConfigurator<TState, T>) => void): void {
        this._events[eventClass.Name] = eventClass;
        this._eventsSelector[eventClass.Name] = selector;
    }

    Initially(when: IEventActivityBinder<TState, any>): void {
        (when as EventActivityBinder<TState, any>).addPreviousState(this.StateFinalize);
    }

    During<T>(duringClass: IState, listens: IEventActivityBinder<TState, any>[]) {
        Logger.verbose((duringClass as SagaState<any>).Name )
        for (const element of listens) {
            let sagaState = element as EventActivityBinder<TState, any>
            (this._workflow[sagaState.getEventClass().name] as EventActivityBinder<TState, any>).addPreviousState(duringClass)
        }
        return;
    }

    When<TEvent>(whenClass: { new(...args: any[]): TEvent }): IEventActivityBinder<TState, TEvent> {
        this._workflow[whenClass.name] = this._workflow[whenClass.name] ?? new EventActivityBinder<TState, TEvent>(whenClass);
        this._workflow[whenClass.name].setStateClass(this);
        return this._workflow[whenClass.name]
    }

    async Consume<TMessage extends TState>(ctx: BehaviorContext<SagaStateMachineInstance, TMessage>, context: ISagaConsumeContext<TState, TMessage>): Promise<any> {
        await super.Consume(ctx, context);

        let fullMessage = bufferToStringJson((context as any).content)
        // let receiveEvent = this.getExchange(context.fields?.exchange);
        let receiveEvent = getLastPart(fullMessage.messageType);
        let currentState = this._workflow[receiveEvent];

        // Saga message
        // let ctx = new BehaviorContext<SagaStateMachineInstance, any>();
        if (!ctx.Saga) ctx.Saga = new this._classMessage();
        ctx.Message = (context as any).Message;

        // Mapping event, get custom CorrelationId
        this._eventsSelector[receiveEvent](new EventCorrelationConfigurator(ctx)); // mapping CorrelationId, ex: Event(this.OrderSubmitted, x => x.CorrelateById(m => m.Message.OrderId))
        // if (!this.sagaStore[ctx.Saga.CorrelationId]) {
        //     // ctx.Saga.CurrentState = this.StateInitially.Name;
        //     // this.sagaStore[ctx.Saga.CorrelationId] = ctx.Saga;
        // } else {
        //     // ctx.Saga = this.sagaStore[ctx.Saga.CorrelationId];
        // }
        if (!ctx.Saga.CurrentState) {
            ctx.Saga.CurrentState = this.StateInitially.Name;
        }

        Logger.log(`[SG] ****** Receive Event: ` + receiveEvent + ', CorrelationId: ' + ctx.Saga.CorrelationId);
        //Logger.log(`[SG] SagaState current: ${ctx.Saga.CurrentState} , msg: ${JSON.stringify(this.sagaStore[ctx.Saga.CorrelationId])}`)
        Logger.log(`[SG] SagaState current: ${ctx.Saga.CurrentState} , msg: ${JSON.stringify(ctx.Saga)}`)

        // Check event in State
        if ([this.StateInitially.Name].includes(ctx.Saga.CurrentState) == false && !currentState.previousStates[ctx.Saga.CurrentState]) {
            throw Error(`[SG] SagaState: ${ctx.Saga.CorrelationId} is canceled`)
        }

        // Run step workflow
        if (currentState.stepThen) {
            currentState.stepThen(ctx)
        }

        if (currentState.transitionTo) {
            Logger.log(`[SG] Event ${receiveEvent} => TransitionTo ${currentState.transitionTo.Name}`)
            ctx.Saga.CurrentState = currentState.transitionTo.Name;
        }

        let getResult = true;
        if (currentState.publishAsync) {
            ctx.producerClient = super.producer;
            const msg = await currentState.publishAsync(ctx)
            getResult = await ctx.producerClient.Send(msg, ctx);
        }

        // console.log('Node ' + process.env.PORT)
        // console.log(ctx.Saga)

        if (currentState.finalize) {
            Logger.log(`[SG] Event ${receiveEvent} => TransitionTo Finalize`)
            ctx.Saga.CurrentState = this.StateFinalize.Name;
            Logger.log(`[SG] Saga CorrelationId: ${ctx.Saga.CorrelationId} is released`)
            this._finalized(ctx);
            if (this.setCompletedWhenFinalized) return getResult;
        }

        return getResult;

    }
}