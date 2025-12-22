
import {Inject, Injectable, Logger} from "@nestjs/common";
import {OrderConfirmed, ProcessPayment, RefundPayment, ReserveInventory, OrderFailed} from "@shared/messages/message";
import { BusTransitStateMachine, SagaEvent, SagaState, SagaStateMachineInstance } from "nestjs-bustransit";

import {v7 as uuidv7} from "uuid";

export class OrderState extends SagaStateMachineInstance
{
    public CorrelationId: string;
    public CurrentState: string;

    // Business data
    public OrderTotal: number;
    public PaymentIntentId: string
    public OrderDate: Date;
    public CustomerEmail: string;
}

/* Events */
export class OrderSubmitted
{
    public OrderId: string;
    public Total: number;
    public Email: string;

    constructor({OrderId, Total, Email}) {
        this.OrderId = OrderId;
        this.Total = Total;
        this.Email = Email;
    }
}

export class PaymentProcessed
{
    public OrderId: string;
    public PaymentIntentId: string;
}

export class InventoryReserved
{
    public OrderId: string;
}

/* Saga State Machine */
@Injectable()
export class OrderStateMachine extends BusTransitStateMachine<OrderState> {

    // State
    ProcessingPayment = new SagaState('ProcessingPayment');
    ReservingInventory = new SagaState('ReservingInventory');
    Completed = new SagaState('Completed');
    Failed = new SagaState('Failed');

    // Events
    OrderSubmitted = new SagaEvent(OrderSubmitted);
    PaymentProcessed = new SagaEvent(PaymentProcessed);
    InventoryReserved = new SagaEvent(InventoryReserved);
    OrderFailed = new SagaEvent(OrderFailed);

    constructor() {
        super(OrderState);

        // Define all Events
        this.Event(this.OrderSubmitted, x => x.CorrelateById(m => m.Message.OrderId));
        this.Event(this.PaymentProcessed, x => x.CorrelateById(m => m.Message.OrderId))
        this.Event(this.InventoryReserved,x => x.CorrelateById(m => m.Message.OrderId))
        this.Event(this.OrderFailed, x => x.CorrelateById(m => m.Message.OrderId))

        // Define behaviours
        this.Initially(
            this.When(OrderSubmitted).Then(
                c => {
                    c.Saga.OrderTotal = c.Message.Total;
                    c.Saga.CustomerEmail = c.Message.Email;
                    c.Saga.OrderDate = new Date();
                }
            )
            .PublishAsync<ProcessPayment>(ProcessPayment, c => {
                // Behaviour
                let processPayment = new ProcessPayment();
                processPayment.OrderId = c.Saga.CorrelationId;
                processPayment.Amount = c.Saga.OrderTotal;
                return processPayment;
            })
            .TransitionTo(this.ProcessingPayment),
        )

        this.During(this.ProcessingPayment, [
            this.When(PaymentProcessed)
            .Then(
                c => {
                    c.Saga.PaymentIntentId = c.Message.PaymentIntentId;
                }
            )
            .PublishAsync<ReserveInventory>(ReserveInventory, c => {
                // Behaviour
                let reserveInventory = new ReserveInventory();
                reserveInventory.OrderId = c.Saga.CorrelationId;
                return reserveInventory;
            })
            .TransitionTo(this.ReservingInventory),

            this.When(OrderFailed).TransitionTo(this.Failed).Finalize()
        ] )

        this.During(this.ReservingInventory, [

            this.When(InventoryReserved)
            .PublishAsync<OrderConfirmed>(OrderConfirmed,c => {
                let orderConfirmed = new OrderConfirmed();
                orderConfirmed.OrderId = c.Saga.CorrelationId;
                return orderConfirmed;
            }).TransitionTo(this.Completed).Finalize(),

            this.When(OrderFailed)
            .PublishAsync<RefundPayment>(RefundPayment, c => {
                let refundPayment = new RefundPayment();
                refundPayment.OrderId = c.Saga.CorrelationId;
                refundPayment.Amount =  c.Saga.OrderTotal;
                return refundPayment;
            }).TransitionTo(this.Failed).Finalize(),

        ] )

        this.SetCompletedWhenFinalized(c => {
            console.log('Result saga')
            console.log(c.Saga)
        });
    }
}