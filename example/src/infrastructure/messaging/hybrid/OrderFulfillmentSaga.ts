/**
 * Order Fulfillment Saga - Hybrid Pattern Example
 *
 * This saga demonstrates combining the Saga pattern with Routing Slips:
 * - Saga: Manages high-level order state transitions (Submitted → Processing → Fulfilled → Shipped)
 * - Routing Slips: Handle complex multi-step operations within saga steps (e.g., fulfillment process)
 *
 * Benefits of this hybrid approach:
 * 1. Saga provides long-running transaction coordination across services
 * 2. Routing slips provide fine-grained compensation for complex multi-step operations
 * 3. Clear separation between business workflow (saga) and operational details (routing slips)
 *
 * Example flow:
 * OrderSubmitted → ExecuteFulfillment (routing slip) → FulfillmentCompleted → ArrangeShipping
 */

import { Injectable, Logger } from "@nestjs/common";
import { BusTransitStateMachine, SagaEvent, SagaState, SagaStateMachineInstance } from "nestjs-bustransit";

/**
 * Saga instance state
 */
export class OrderFulfillmentState extends SagaStateMachineInstance {
    public CorrelationId: string;
    public CurrentState: string;

    // Business data
    public OrderId: string;
    public CustomerId: string;
    public CustomerEmail: string;
    public TotalAmount: number;
    public Items: Array<{ sku: string; quantity: number }>;

    // Fulfillment data (populated by routing slip)
    public FulfillmentId: string;
    public WarehouseId: string;
    public TrackingNumber: string;

    // Timestamps
    public OrderDate: Date;
    public FulfillmentDate: Date;
    public ShipDate: Date;
}

/**
 * Saga Events
 */

export class OrderSubmittedForFulfillment {
    public OrderId: string;
    public CustomerId: string;
    public CustomerEmail: string;
    public TotalAmount: number;
    public Items: Array<{ sku: string; quantity: number }>;
}

export class ExecuteFulfillment {
    public OrderId: string;
    public Items: Array<{ sku: string; quantity: number }>;
}

export class FulfillmentCompleted {
    public OrderId: string;
    public FulfillmentId: string;
    public WarehouseId: string;
}

export class FulfillmentFailed {
    public OrderId: string;
    public Reason: string;
}

export class ArrangeShipping {
    public OrderId: string;
    public FulfillmentId: string;
    public WarehouseId: string;
    public CustomerEmail: string;
}

export class ShippingArranged {
    public OrderId: string;
    public TrackingNumber: string;
}

export class ShippingFailed {
    public OrderId: string;
    public Reason: string;
}

export class NotifyCustomer {
    public OrderId: string;
    public CustomerEmail: string;
    public TrackingNumber: string;
}

/**
 * Order Fulfillment Saga State Machine
 *
 * Orchestrates the order fulfillment process using both saga state management
 * and routing slips for complex operations.
 */
@Injectable()
export class OrderFulfillmentSaga extends BusTransitStateMachine<OrderFulfillmentState> {

    // States
    ProcessingOrder = new SagaState('ProcessingOrder');
    FulfillingOrder = new SagaState('FulfillingOrder');
    ArrangingShipping = new SagaState('ArrangingShipping');
    Completed = new SagaState('Completed');
    Failed = new SagaState('Failed');

    // Events
    OrderSubmittedForFulfillment = new SagaEvent(OrderSubmittedForFulfillment);
    FulfillmentCompleted = new SagaEvent(FulfillmentCompleted);
    FulfillmentFailed = new SagaEvent(FulfillmentFailed);
    ShippingArranged = new SagaEvent(ShippingArranged);
    ShippingFailed = new SagaEvent(ShippingFailed);

    constructor(stateClass?: any) {
        super(stateClass || OrderFulfillmentState);

        // Configure event correlation
        this.Event(this.OrderSubmittedForFulfillment, x => x.CorrelateById(m => m.Message.OrderId));
        this.Event(this.FulfillmentCompleted, x => x.CorrelateById(m => m.Message.OrderId));
        this.Event(this.FulfillmentFailed, x => x.CorrelateById(m => m.Message.OrderId));
        this.Event(this.ShippingArranged, x => x.CorrelateById(m => m.Message.OrderId));
        this.Event(this.ShippingFailed, x => x.CorrelateById(m => m.Message.OrderId));

        // Initial state: When order is submitted, initiate fulfillment
        this.Initially(
            this.When(OrderSubmittedForFulfillment)
                .Then(c => {
                    Logger.log(`[OrderFulfillmentSaga] Order submitted: ${c.Message.OrderId}`);
                    c.Saga.OrderId = c.Message.OrderId;
                    c.Saga.CustomerId = c.Message.CustomerId;
                    c.Saga.CustomerEmail = c.Message.CustomerEmail;
                    c.Saga.TotalAmount = c.Message.TotalAmount;
                    c.Saga.Items = c.Message.Items;
                    c.Saga.OrderDate = new Date();
                })
                .PublishAsync<ExecuteFulfillment>(ExecuteFulfillment, c => {
                    // This message will trigger a consumer that executes a routing slip
                    // The routing slip will handle: Pick → Pack → Label → QualityCheck
                    const command = new ExecuteFulfillment();
                    command.OrderId = c.Saga.OrderId;
                    command.Items = c.Saga.Items;
                    Logger.log(`[OrderFulfillmentSaga] Publishing ExecuteFulfillment command for routing slip execution`);
                    return command;
                })
                .TransitionTo(this.FulfillingOrder)
        );

        // During fulfillment state
        this.During(this.FulfillingOrder, [
            // Success path: Fulfillment completed by routing slip
            this.When(FulfillmentCompleted)
                .Then(c => {
                    Logger.log(`[OrderFulfillmentSaga] Fulfillment completed: ${c.Message.FulfillmentId}`);
                    c.Saga.FulfillmentId = c.Message.FulfillmentId;
                    c.Saga.WarehouseId = c.Message.WarehouseId;
                    c.Saga.FulfillmentDate = new Date();
                })
                .PublishAsync<ArrangeShipping>(ArrangeShipping, c => {
                    const command = new ArrangeShipping();
                    command.OrderId = c.Saga.OrderId;
                    command.FulfillmentId = c.Saga.FulfillmentId;
                    command.WarehouseId = c.Saga.WarehouseId;
                    command.CustomerEmail = c.Saga.CustomerEmail;
                    Logger.log(`[OrderFulfillmentSaga] Publishing ArrangeShipping command`);
                    return command;
                })
                .TransitionTo(this.ArrangingShipping),

            // Failure path: Fulfillment failed (routing slip compensated)
            this.When(FulfillmentFailed)
                .Then(c => {
                    Logger.error(`[OrderFulfillmentSaga] Fulfillment failed: ${c.Message.Reason}`);
                    Logger.log(`[OrderFulfillmentSaga] Routing slip has already compensated all completed activities`);
                })
                .TransitionTo(this.Failed)
                .Finalize()
        ]);

        // During shipping arrangement state
        this.During(this.ArrangingShipping, [
            // Success path: Shipping arranged
            this.When(ShippingArranged)
                .Then(c => {
                    Logger.log(`[OrderFulfillmentSaga] Shipping arranged: ${c.Message.TrackingNumber}`);
                    c.Saga.TrackingNumber = c.Message.TrackingNumber;
                    c.Saga.ShipDate = new Date();
                })
                .PublishAsync<NotifyCustomer>(NotifyCustomer, c => {
                    const command = new NotifyCustomer();
                    command.OrderId = c.Saga.OrderId;
                    command.CustomerEmail = c.Saga.CustomerEmail;
                    command.TrackingNumber = c.Saga.TrackingNumber;
                    Logger.log(`[OrderFulfillmentSaga] Publishing NotifyCustomer command`);
                    return command;
                })
                .TransitionTo(this.Completed)
                .Finalize(),

            // Failure path: Shipping failed
            this.When(ShippingFailed)
                .Then(c => {
                    Logger.error(`[OrderFulfillmentSaga] Shipping failed: ${c.Message.Reason}`);
                })
                .TransitionTo(this.Failed)
                .Finalize()
        ]);

        this.SetCompletedWhenFinalized(c => {
            Logger.log(`[OrderFulfillmentSaga] Saga finalized for order: ${c.Saga.OrderId}`);
            Logger.log(`[OrderFulfillmentSaga] Final state: ${c.Saga.CurrentState}`);
            if (c.Saga.TrackingNumber) {
                Logger.log(`[OrderFulfillmentSaga] Tracking number: ${c.Saga.TrackingNumber}`);
            }
        });
    }
}
