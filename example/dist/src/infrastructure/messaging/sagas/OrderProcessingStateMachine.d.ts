import { OrderFailed } from "@shared/messages/message";
import { BusTransitStateMachine, SagaStateMachineInstance, SagaEvent, SagaState } from "nestjs-bustransit";
export declare class OrderState extends SagaStateMachineInstance {
    CorrelationId: string;
    CurrentState: string;
    OrderTotal: number;
    PaymentIntentId: string;
    OrderDate: Date;
    CustomerEmail: string;
}
export declare class OrderSubmitted {
    OrderId: string;
    Total: number;
    Email: string;
    constructor({ OrderId, Total, Email }: {
        OrderId: any;
        Total: any;
        Email: any;
    });
}
export declare class PaymentProcessed {
    OrderId: string;
    PaymentIntentId: string;
}
export declare class InventoryReserved {
    OrderId: string;
}
export declare class OrderStateMachine extends BusTransitStateMachine<OrderState> {
    ProcessingPayment: SagaState<unknown>;
    ReservingInventory: SagaState<unknown>;
    Completed: SagaState<unknown>;
    Failed: SagaState<unknown>;
    OrderSubmitted: SagaEvent<OrderSubmitted>;
    PaymentProcessed: SagaEvent<PaymentProcessed>;
    InventoryReserved: SagaEvent<InventoryReserved>;
    OrderFailed: SagaEvent<OrderFailed>;
    constructor();
}
