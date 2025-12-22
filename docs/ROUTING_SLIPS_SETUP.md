# Setting Up Routing Slips

This guide provides a step-by-step approach to setting up the Routing Slips pattern in your NestJS application.

## 1. Installation

First, install the required packages:

```bash
npm install nestjs-bustransit uuid
# or
yarn add nestjs-bustransit uuid
```

## 2. Define Activities

Create your activities by implementing the `IActivity` or `IExecuteActivity` interface.

```typescript
// src/activities/process-payment.activity.ts
import { Injectable, Logger } from '@nestjs/common';
import { IActivity, IExecuteContext, IActivityResult, ICompensateContext } from 'nestjs-bustransit';

@Injectable()
export class ProcessPaymentActivity implements IActivity<any, any> {
  name = 'ProcessPayment';

  async execute(context: IExecuteContext<any>): Promise<IActivityResult> {
    Logger.log('Processing payment...');
    return context.completed();
  }

  async compensate(context: ICompensateContext<any>): Promise<void> {
    Logger.log('Compensating payment...');
  }
}
```

## 3. Create Activity Factory

The executor needs a factory to instantiate activities.

```typescript
// src/activities/activity.factory.ts
import { Injectable } from '@nestjs/common';
import { IActivityFactory } from 'nestjs-bustransit';
import { ProcessPaymentActivity } from './process-payment.activity';

@Injectable()
export class ActivityFactory implements IActivityFactory {
  private activities = new Map();

  constructor(
    private readonly processPayment: ProcessPaymentActivity
    // inject other activities here
  ) {
    this.activities.set('ProcessPayment', this.processPayment);
  }

  createActivity(activityName: string): any {
    const activity = this.activities.get(activityName);
    if (!activity) {
      throw new Error(`Activity ${activityName} not registered`);
    }
    return activity;
  }
}
```

## 4. Register in Module

Register your activities, factory, and service in your NestJS module.

```typescript
// src/app.module.ts
import { Module } from '@nestjs/common';
import { ProcessPaymentActivity } from './activities/process-payment.activity';
import { ActivityFactory } from './activities/activity.factory';
import { OrderService } from './order.service';

@Module({
  providers: [
    ProcessPaymentActivity,
    ActivityFactory,
    OrderService
  ]
})
export class AppModule {}
```

## 5. Implement Service

Create a service to build and execute routing slips.

```typescript
// src/order.service.ts
import { Injectable } from '@nestjs/common';
import { RoutingSlipBuilder, RoutingSlipExecutor } from 'nestjs-bustransit';
import { ActivityFactory } from './activities/activity.factory';

@Injectable()
export class OrderService {
  private executor: RoutingSlipExecutor;

  constructor(activityFactory: ActivityFactory) {
    this.executor = new RoutingSlipExecutor(activityFactory);
  }

  async createOrder(orderId: string) {
    const routingSlip = RoutingSlipBuilder.create(orderId)
      .addActivity('ProcessPayment', 'payment-queue', { amount: 100 })
      .build();

    await this.executor.execute(routingSlip);
  }
}
```

## 6. Distributed vs Local

- **Local Execution**: The default `RoutingSlipExecutor` runs activities locally within the same process if they are registered in the factory.
- **Distributed Execution**: To distribute activities across microservices, you would typically use the `BusTransit` message broker capabilities to send the routing slip to a queue where another service picks it up. *Note: Detailed distributed configuration depends on your specific transport setup (RabbitMQ usually).*

## Next Steps

- Check out the **[Quick Start Guide](./ROUTING_SLIPS_QUICKSTART.md)** for a complete running example.
- Read **[Routing Slips Concepts](./ROUTING_SLIPS_CONCEPTS.md)** for deeper understanding.
