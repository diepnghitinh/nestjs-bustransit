import {IsNotEmpty} from "@nestjs/class-validator";

export class ProcessPayment {
    @IsNotEmpty()
    OrderId: string;

    @IsNotEmpty()
    Amount: number;
}

export class RefundPayment {
    OrderId: string;
    Amount: number;
}

export class OrderConfirmed {
    OrderId: string;
}

export class ReserveInventory {
    OrderId: string;
}

export class OrderFailed {
    OrderId: string;
    Reason: string;
}