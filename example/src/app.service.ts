import {Inject, Injectable} from '@nestjs/common';
import {OrderSubmitted} from "@infrastructure/messaging/sagas/OrderProcessingStateMachine";
import { v7 as uuidv7 } from 'uuid';
import {OrderMessage} from "@infrastructure/messaging/consumers/SubmitOrderConsumer";
import { OrderProcessingService } from '@infrastructure/messaging/routing-slips/OrderProcessingService';
import { IPublishEndpoint } from 'nestjs-bustransit';

@Injectable()
export class AppService {
  constructor(
      @Inject(IPublishEndpoint)
      private readonly publishEndpoint: IPublishEndpoint,
      private readonly orderProcessingService: OrderProcessingService,
  ) {
  }

  testConsumer(): void {
      let msg = new OrderMessage();
      msg.Text = 'hello world';
      this.publishEndpoint.Publish<OrderMessage>(msg);
  }

  async testSaga(): Promise<any> {
    const rs = await this.publishEndpoint.Send<OrderSubmitted>(new OrderSubmitted(
        {
            OrderId: uuidv7(),
            Total: 10000,
            Email: 'test@gmail.com'
        }
    ), null);
    return rs;
  }

  /**
   * Test Routing Slips pattern with order processing
   * Demonstrates: activity execution, compensation, and event monitoring
   */
  async testRoutingSlip(): Promise<any> {
    const orderId = uuidv7();

    try {
      await this.orderProcessingService.processOrder(
        orderId,
        199.99,
        'customer_123',
        'customer@example.com',
        [
          { sku: 'PROD-001', quantity: 2 },
          { sku: 'PROD-002', quantity: 1 }
        ]
      );

      return {
        success: true,
        message: 'Routing slip executed successfully',
        orderId,
        activities: ['ProcessPayment', 'ReserveInventory', 'SendConfirmation']
      };
    } catch (error) {
      return {
        success: false,
        message: 'Routing slip execution failed (compensation triggered)',
        orderId,
        error: error.message
      };
    }
  }
}
