import {IBusTransitStateMachine} from "../interfaces/saga.bustransit.state-machine.interface";
import {EventActivityBinder} from "./event.activity-binder";
import {BusTransitConsumer} from "./consumer";
import {Injectable, Logger, Optional, Inject} from "@nestjs/common";
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
import {ISagaRepository} from "../interfaces/saga-repository.interface";
import {SAGA_REPOSITORY, SAGA_PERSISTENCE_OPTIONS} from "../constants/saga-persistence.constants";
import {SagaPersistenceOptions} from "../interfaces/saga-persistence-options.interface";
import {InMemorySagaRepository} from "../persistence/repositories/in-memory-saga.repository";

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
    private repository: ISagaRepository<any>;
    private autoArchive: boolean = false;

    constructor(
        stateClass: { new(...args: any[]): TState },
        repository?: ISagaRepository<any>,
        options?: SagaPersistenceOptions
    ) {
        super(stateClass);
        this._classMessage = stateClass;

        // Use provided repository or fallback to in-memory (backward compatibility)
        this.repository = repository || new InMemorySagaRepository<any>();

        // Set state class on repository for deserialization
        if (this.repository['setStateClass']) {
            this.repository['setStateClass'](stateClass);
        }

        // Configure auto-archive from options
        this.autoArchive = options?.autoArchive || false;

        Logger.log(`[SG] Saga state machine ${stateClass.name} initialized with ${repository ? repository.constructor.name : 'in-memory'} repository`);
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
        let currentState = this._workflow[receiveEvent] as EventActivityBinder<TState, any>;

        // Saga message
        // let ctx = new BehaviorContext<SagaStateMachineInstance, any>();
        if (!ctx.Saga) ctx.Saga = new this._classMessage();
        ctx.Message = (context as any).Message;

        // Mapping event, get custom CorrelationId
        this._eventsSelector[receiveEvent](new EventCorrelationConfigurator(ctx)); // mapping CorrelationId, ex: Event(this.OrderSubmitted, x => x.CorrelateById(m => m.Message.OrderId))

        // Load existing saga or create new one
        const existingSaga = await this.repository.findByCorrelationId(ctx.Saga.CorrelationId);
        if (existingSaga) {
            ctx.Saga = existingSaga;
            Logger.log(`[SG] Loaded existing saga: ${ctx.Saga.CorrelationId}, State: ${ctx.Saga.CurrentState}`);
        } else {
            ctx.Saga.CurrentState = this.StateInitially.Name;
            Logger.log(`[SG] Created new saga: ${ctx.Saga.CorrelationId}`);
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
            currentState.stepThen(ctx as any)
        }

        if (currentState.transitionTo) {
            Logger.log(`[SG] Event ${receiveEvent} => TransitionTo ${currentState.transitionTo.Name}`)
            ctx.Saga.CurrentState = currentState.transitionTo.Name;
        }

        let getResult = true;
        if (currentState.publishAsync) {
            ctx.producerClient = super.producer;
            const msg = await currentState.publishAsync(ctx as any)
            getResult = await ctx.producerClient.Send(msg, ctx);
        }

        // Save saga state after transition
        await this.repository.save(ctx.Saga);
        Logger.log(`[SG] Saved saga state: ${ctx.Saga.CorrelationId}`);

        // console.log('Node ' + process.env.PORT)
        // console.log(ctx.Saga)

        if (currentState.finalize) {
            Logger.log(`[SG] Event ${receiveEvent} => TransitionTo Finalize`)
            ctx.Saga.CurrentState = this.StateFinalize.Name;
            Logger.log(`[SG] Saga CorrelationId: ${ctx.Saga.CorrelationId} is released`)
            this._finalized(ctx);

            // Archive or delete based on configuration
            if (this.autoArchive) {
                await this.repository.archive(ctx.Saga.CorrelationId);
                Logger.log(`[SG] Archived saga: ${ctx.Saga.CorrelationId}`);
            } else {
                await this.repository.delete(ctx.Saga.CorrelationId);
                Logger.log(`[SG] Deleted saga: ${ctx.Saga.CorrelationId}`);
            }

            if (this.setCompletedWhenFinalized) return getResult;
        }

        return getResult;

    }
}