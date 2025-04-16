import {BusTransitStateMachine} from "@core/bustransit/factories/saga.bustransit.state-machine";

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
class OrderSubmitted
{
    public OrderId: string;
    public decimal: number;
    public Email: string;
}

class PaymentProcessed
{
    public OrderId: string;
    public PaymentIntentId: string;
}

class InventoryReserved
{
    public OrderId: string;
}

class OrderFailed
{
    public OrderId: string;
    public Reason: string;
}

/* Machine */
export class OrderStateMachine extends BusTransitStateMachine<OrderState> {

    ProcessingPayment: IState;
    ReservingInventory: IState;
    Completed: IState;
    Failed: IState;

    OrderSubmitted: IEvent<OrderSubmitted>;
    PaymentProcessed: IEvent<PaymentProcessed>;
    InventoryReserved: IEvent<InventoryReserved>;
    OrderFailed: IEvent<OrderFailed>;

    constructor() {
        super();

        this.Event(OrderSubmitted)

        // Initially(params EventActivities<TInstance>[] activities)
        // {
        //     During(Initial, activities);
        // }

        // Initially()

        this.SetCompletedWhenFinalized();
    }
}