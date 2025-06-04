export declare class ProcessPayment {
    OrderId: string;
    Amount: number;
}
export declare class RefundPayment {
    OrderId: string;
    Amount: number;
}
export declare class OrderConfirmed {
    OrderId: string;
}
export declare class ReserveInventory {
    OrderId: string;
}
export declare class OrderFailed {
    OrderId: string;
    Reason: string;
}
