# Routing Slips Quick Start Guide

Get up and running with routing slips in 10 minutes! This guide shows you how to create your first routing slip workflow.

## What You'll Build

A simple order processing workflow:
1. **Process Payment** - Charge the customer
2. **Reserve Inventory** - Reserve items
3. **Send Confirmation** - Email confirmation

If any step fails, completed steps automatically roll back (refund payment, release inventory).

## Step 1: Install Dependencies

```bash
npm install nestjs-bustransit uuid
# or
yarn add nestjs-bustransit uuid
```

## Step 2: Create Your First Activity

Activities are self-contained units of work. Let's create a payment processing activity:

```typescript
// process-payment.activity.ts
import { Injectable, Logger } from '@nestjs/common';
import {
  IActivity,
  IExecuteContext,
  IActivityResult,
  ICompensateContext
} from 'nestjs-bustransit';

// Arguments passed to the activity
export interface ProcessPaymentArgs {
  orderId: string;
  amount: number;
  customerId: string;
}

// Data saved for compensation
export interface ProcessPaymentLog {
  paymentIntentId: string;
  amount: number;
  timestamp: Date;
}

@Injectable()
export class ProcessPaymentActivity implements IActivity<ProcessPaymentArgs, ProcessPaymentLog> {
  name = 'ProcessPayment';

  async execute(context: IExecuteContext<ProcessPaymentArgs>): Promise<IActivityResult> {
    try {
      Logger.log(`[ProcessPayment] Processing payment for order ${context.arguments.orderId}`);

      // Simulate charging customer
      const paymentIntentId = `pi_${Date.now()}_${context.arguments.orderId}`;

      Logger.log(`[ProcessPayment] Payment successful: ${paymentIntentId}`);

      // Pass data to next activities via variables
      const variables = new Map(context.variables);
      variables.set('paymentIntentId', paymentIntentId);

      // Save data needed for compensation (refund)
      const compensationLog: ProcessPaymentLog = {
        paymentIntentId,
        amount: context.arguments.amount,
        timestamp: new Date()
      };

      return context.completedWithVariables(variables, compensationLog);

    } catch (error) {
      Logger.error(`[ProcessPayment] Failed: ${error.message}`);
      return context.faulted(error);
    }
  }

  // Called automatically if a later activity fails
  async compensate(context: ICompensateContext<ProcessPaymentLog>): Promise<void> {
    Logger.log(`[ProcessPayment] Refunding payment: ${context.compensationLog.paymentIntentId}`);

    // Simulate refund
    await new Promise(resolve => setTimeout(resolve, 100));

    Logger.log(`[ProcessPayment] Refund successful: $${context.compensationLog.amount}`);
  }
}
```

## Step 3: Create More Activities

```typescript
// reserve-inventory.activity.ts
import { Injectable, Logger } from '@nestjs/common';
import { IActivity, IExecuteContext, IActivityResult, ICompensateContext } from 'nestjs-bustransit';

export interface ReserveInventoryArgs {
  orderId: string;
  items: Array<{ sku: string; quantity: number }>;
}

export interface ReserveInventoryLog {
  reservationId: string;
  items: Array<{ sku: string; quantity: number }>;
}

@Injectable()
export class ReserveInventoryActivity implements IActivity<ReserveInventoryArgs, ReserveInventoryLog> {
  name = 'ReserveInventory';

  async execute(context: IExecuteContext<ReserveInventoryArgs>): Promise<IActivityResult> {
    Logger.log(`[ReserveInventory] Reserving inventory for ${context.arguments.orderId}`);

    const reservationId = `res_${Date.now()}_${context.arguments.orderId}`;

    const variables = new Map(context.variables);
    variables.set('reservationId', reservationId);

    return context.completedWithVariables(variables, {
      reservationId,
      items: context.arguments.items
    });
  }

  async compensate(context: ICompensateContext<ReserveInventoryLog>): Promise<void> {
    Logger.log(`[ReserveInventory] Releasing inventory: ${context.compensationLog.reservationId}`);
    // Release inventory...
  }
}
```

```typescript
// send-confirmation.activity.ts
import { Injectable, Logger } from '@nestjs/common';
import { IExecuteActivity, IExecuteContext, IActivityResult } from 'nestjs-bustransit';

export interface SendConfirmationArgs {
  orderId: string;
  customerEmail: string;
}

@Injectable()
export class SendConfirmationActivity implements IExecuteActivity<SendConfirmationArgs> {
  name = 'SendConfirmation';

  async execute(context: IExecuteContext<SendConfirmationArgs>): Promise<IActivityResult> {
    Logger.log(`[SendConfirmation] Sending email to ${context.arguments.customerEmail}`);

    // Access data from previous activities
    const paymentId = context.variables.get('paymentIntentId');
    const reservationId = context.variables.get('reservationId');

    Logger.log(`[SendConfirmation] Order details - Payment: ${paymentId}, Reservation: ${reservationId}`);

    // Send email...

    return context.completed(); // No compensation - can't "unsend" email
  }
}
```

## Step 4: Create Activity Factory

The factory provides activity instances to the executor:

```typescript
// order-activity.factory.ts
import { Injectable } from '@nestjs/common';
import { IActivityFactory } from 'nestjs-bustransit';
import { ProcessPaymentActivity } from './process-payment.activity';
import { ReserveInventoryActivity } from './reserve-inventory.activity';
import { SendConfirmationActivity } from './send-confirmation.activity';

@Injectable()
export class OrderActivityFactory implements IActivityFactory {
  private activities = new Map();

  constructor(
    private readonly processPayment: ProcessPaymentActivity,
    private readonly reserveInventory: ReserveInventoryActivity,
    private readonly sendConfirmation: SendConfirmationActivity
  ) {
    // Register activities by name
    this.activities.set('ProcessPayment', this.processPayment);
    this.activities.set('ReserveInventory', this.reserveInventory);
    this.activities.set('SendConfirmation', this.sendConfirmation);
  }

  createActivity(activityName: string): any {
    const activity = this.activities.get(activityName);
    if (!activity) {
      throw new Error(`Activity not found: ${activityName}`);
    }
    return activity;
  }
}
```

## Step 5: Create Order Service

Use the routing slip builder and executor:

```typescript
// order.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { RoutingSlipBuilder, RoutingSlipExecutor } from 'nestjs-bustransit';
import { OrderActivityFactory } from './order-activity.factory';

@Injectable()
export class OrderService {
  private executor: RoutingSlipExecutor;

  constructor(activityFactory: OrderActivityFactory) {
    this.executor = new RoutingSlipExecutor(activityFactory);

    // Optional: Subscribe to events for monitoring
    this.executor.subscribe({
      async onCompleted(event) {
        Logger.log(`✅ Order completed: ${event.trackingNumber}`);
      },

      async onFaulted(event) {
        Logger.error(`❌ Order failed: ${event.trackingNumber}`);
        Logger.error(`Errors: ${event.activityExceptions.map(e => e.exceptionInfo.message).join(', ')}`);
      },

      async onActivityCompleted(event) {
        Logger.log(`✓ Activity completed: ${event.activityName}`);
      },

      async onActivityCompensated(event) {
        Logger.log(`↩️  Activity compensated: ${event.activityName}`);
      }
    });
  }

  async processOrder(orderId: string, amount: number, customerEmail: string, items: any[]): Promise<void> {
    Logger.log(`🚀 Starting order processing: ${orderId}`);

    try {
      // Build the routing slip
      const routingSlip = RoutingSlipBuilder.create(orderId)
        // Activity 1: Process payment
        .addActivity('ProcessPayment', 'payment-service', {
          orderId,
          amount,
          customerId: 'customer-123'
        })
        // Activity 2: Reserve inventory
        .addActivity('ReserveInventory', 'inventory-service', {
          orderId,
          items
        })
        // Activity 3: Send confirmation
        .addActivity('SendConfirmation', 'email-service', {
          orderId,
          customerEmail
        })
        // Add initial variables
        .addVariable('orderId', orderId)
        .addVariable('customerEmail', customerEmail)
        .build();

      Logger.log(`📋 Routing slip created with ${routingSlip.itinerary.length} activities`);

      // Execute the routing slip
      await this.executor.execute(routingSlip);

      Logger.log(`✅ Order processing completed: ${orderId}`);

    } catch (error) {
      Logger.error(`❌ Order processing failed: ${orderId} - ${error.message}`);
      throw error;
    }
  }
}
```

## Step 6: Register in Module

```typescript
// order.module.ts
import { Module } from '@nestjs/common';
import { OrderService } from './order.service';
import { OrderActivityFactory } from './order-activity.factory';
import { ProcessPaymentActivity } from './process-payment.activity';
import { ReserveInventoryActivity } from './reserve-inventory.activity';
import { SendConfirmationActivity } from './send-confirmation.activity';

@Module({
  providers: [
    // Activities
    ProcessPaymentActivity,
    ReserveInventoryActivity,
    SendConfirmationActivity,

    // Factory
    OrderActivityFactory,

    // Service
    OrderService
  ],
  exports: [OrderService]
})
export class OrderModule {}
```

## Step 7: Use It!

```typescript
// order.controller.ts
import { Controller, Post, Body } from '@nestjs/common';
import { OrderService } from './order.service';

@Controller('orders')
export class OrderController {
  constructor(private readonly orderService: OrderService) {}

  @Post()
  async createOrder(@Body() orderDto: any) {
    await this.orderService.processOrder(
      orderDto.orderId,
      orderDto.amount,
      orderDto.customerEmail,
      orderDto.items
    );

    return { success: true, message: 'Order processing started' };
  }
}
```

## What Happens?

### Success Flow ✅

```
1. ProcessPayment Activity
   ├─ Charge $99.99
   ├─ Store: paymentIntentId = "pi_123"
   └─ Compensation log saved

2. ReserveInventory Activity
   ├─ Reserve 2 units
   ├─ Store: reservationId = "res_456"
   └─ Compensation log saved

3. SendConfirmation Activity
   ├─ Send email
   └─ No compensation (can't unsend)

✅ Routing Slip Completed!
```

### Failure Flow with Auto-Compensation ❌

```
1. ProcessPayment Activity
   ├─ Charge $99.99 ✓
   ├─ Store: paymentIntentId = "pi_123"
   └─ Compensation log saved

2. ReserveInventory Activity
   ├─ Try to reserve
   └─ FAULT: Out of stock! ❌

🔄 AUTOMATIC COMPENSATION (Reverse Order - LIFO)

3. Compensate: ProcessPayment
   ├─ Use compensation log: paymentIntentId = "pi_123"
   ├─ Refund $99.99
   └─ Success ✓

❌ Routing Slip Faulted (all compensations completed)
```

## Console Output

**Success:**
```
🚀 Starting order processing: order-123
📋 Routing slip created with 3 activities
[ProcessPayment] Processing payment for order order-123
[ProcessPayment] Payment successful: pi_1703001234_order-123
✓ Activity completed: ProcessPayment
[ReserveInventory] Reserving inventory for order-123
✓ Activity completed: ReserveInventory
[SendConfirmation] Sending email to customer@example.com
[SendConfirmation] Order details - Payment: pi_1703001234_order-123, Reservation: res_1703001235_order-123
✓ Activity completed: SendConfirmation
✅ Order completed: order-123
✅ Order processing completed: order-123
```

**Failure with Compensation:**
```
🚀 Starting order processing: order-123
📋 Routing slip created with 3 activities
[ProcessPayment] Processing payment for order order-123
[ProcessPayment] Payment successful: pi_1703001234_order-123
✓ Activity completed: ProcessPayment
[ReserveInventory] Reserving inventory for order-123
❌ [ReserveInventory] Out of stock!
[RS] Starting compensation for 1 activities
[ProcessPayment] Refunding payment: pi_1703001234_order-123
[ProcessPayment] Refund successful: $99.99
↩️  Activity compensated: ProcessPayment
❌ Order failed: order-123
Errors: Out of stock
❌ Order processing failed: order-123
```

## Next Steps

### Add Error Handling

```typescript
async execute(context: IExecuteContext<Args>): Promise<IActivityResult> {
  try {
    // Your logic
    return context.completed();
  } catch (error) {
    Logger.error(`Activity failed: ${error.message}`);
    return context.faulted(error); // Triggers automatic compensation
  }
}
```

### Make Activities Idempotent

```typescript
async execute(context: IExecuteContext<Args>): Promise<IActivityResult> {
  // Check if already processed
  if (context.variables.has('paymentIntentId')) {
    Logger.log('Payment already processed, skipping');
    return context.completed();
  }

  // Process payment...
}
```

### Add Dynamic Workflows

```typescript
const builder = RoutingSlipBuilder.create(orderId);

builder.addActivity('ProcessPayment', 'payment', paymentArgs);

// Conditional activities
if (order.isInternational) {
  builder.addActivity('CheckCustoms', 'customs', customsArgs);
}

if (order.needsInsurance) {
  builder.addActivity('BuyInsurance', 'insurance', insuranceArgs);
}

builder.addActivity('Ship', 'shipping', shippingArgs);

const routingSlip = builder.build();
```

### Monitor with Events

```typescript
this.executor.subscribe({
  async onActivityCompleted(event) {
    // Send metric to monitoring system
    await metrics.recordActivityDuration(event.activityName, event.duration);
  },

  async onFaulted(event) {
    // Alert on-call engineer
    await alerting.sendAlert(`Routing slip failed: ${event.trackingNumber}`);
  }
});
```

## Learn More

- **[Full Documentation](./ROUTING_SLIPS.md)** - Complete API reference and advanced features
- **[Concepts Guide](./ROUTING_SLIPS_CONCEPTS.md)** - Deep dive into the pattern
- **[Examples](./ROUTING_SLIPS_IMPLEMENTATION_SUMMARY.md)** - More complete examples

## Common Patterns

### Payment + Inventory + Shipping
```typescript
.addActivity('ProcessPayment', 'payment', { amount })
.addActivity('ReserveInventory', 'inventory', { items })
.addActivity('CreateShipment', 'shipping', { address })
```

### Data Transformation Pipeline
```typescript
.addActivity('ExtractData', 'extract', { source })
.addActivity('TransformData', 'transform', { rules })
.addActivity('ValidateData', 'validate', { schema })
.addActivity('LoadData', 'load', { destination })
```

### API Integration
```typescript
.addActivity('CallExternalAPI', 'api', { endpoint })
.addActivity('TransformResponse', 'transform', { mapping })
.addActivity('StoreResult', 'storage', { key })
.addActivity('NotifyWebhook', 'webhook', { url })
```

## Tips

1. **Keep Activities Small** - Each should do one thing
2. **Always Store Compensation Data** - Save everything needed to undo
3. **Make Compensations Idempotent** - Safe to call multiple times
4. **Use Variables** - Pass data between activities
5. **Log Everything** - Helps with debugging
6. **Monitor Events** - Track success/failure rates

Happy routing! 🚀
