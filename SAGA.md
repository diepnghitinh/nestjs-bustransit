Saga 

stateDiagram-v2
[*] --> Initial
Initial --> ProcessingPayment: OrderSubmitted
ProcessingPayment --> Failed: OrderFailed
ProcessingPayment --> ReservingInventory: PaymentProcessed
ReservingInventory --> Failed: OrderFailed
ReservingInventory --> Completed: InventoryReserved
Failed --> [*]
Completed --> [*]
