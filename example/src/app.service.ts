import {Inject, Injectable} from '@nestjs/common';
import {OrderSubmitted} from "@infrastructure/messaging/sagas/OrderProcessingStateMachine";
import { v7 as uuidv7 } from 'uuid';
import {OrderMessage} from "@infrastructure/messaging/consumers/SubmitOrderConsumer";
import { OrderProcessingService } from '@infrastructure/messaging/routing-slips/OrderProcessingService';
import { HybridPatternService } from '@infrastructure/messaging/hybrid/HybridPatternService';
import { IPublishEndpoint } from 'nestjs-bustransit';

@Injectable()
export class AppService {
  constructor(
      @Inject(IPublishEndpoint)
      private readonly publishEndpoint: IPublishEndpoint,
      private readonly orderProcessingService: OrderProcessingService,
      private readonly hybridPatternService: HybridPatternService,
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

  /**
   * Test Routing Slips compensation pattern
   * Demonstrates: automatic compensation (rollback) when an activity fails
   */
  async testRoutingSlipCompensation(): Promise<any> {
    const orderId = uuidv7();

    try {
      await this.orderProcessingService.processOrderWithFailure(
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
        message: 'This should not happen - activity was supposed to fail',
        orderId
      };
    } catch (error) {
      return {
        success: false,
        message: 'Routing slip failed as expected - compensation executed',
        orderId,
        error: error.message,
        compensatedActivities: ['ReserveInventory', 'ProcessPayment'],
        note: 'Check the logs to see the compensation in action (activities are undone in reverse order)'
      };
    }
  }

  /**
   * Test Routing Slips with configurable failure rate
   * Demonstrates: random failures and automatic compensation
   */
  async testRoutingSlipFailureRate(failureRate: number): Promise<any> {
    const orderId = uuidv7();

    try {
      await this.orderProcessingService.processOrderWithFailureRate(
        orderId,
        199.99,
        'customer_123',
        'customer@example.com',
        [
          { sku: 'PROD-001', quantity: 2 },
          { sku: 'PROD-002', quantity: 1 }
        ],
        failureRate
      );

      return {
        success: true,
        message: 'Routing slip executed successfully - no failure occurred',
        orderId,
        failureRate,
        activities: ['ProcessPayment', 'ReserveInventory', 'SendConfirmation'],
        note: 'Try calling again to trigger the failure (random based on failure rate)'
      };
    } catch (error) {
      return {
        success: false,
        message: 'Routing slip failed - automatic compensation executed',
        orderId,
        failureRate,
        error: error.message,
        failedActivity: 'SendConfirmation',
        compensatedActivities: ['ReserveInventory', 'ProcessPayment'],
        note: 'Check the logs to see the failure and compensation sequence'
      };
    }
  }

  /**
   * Test Hybrid Pattern - Saga + Routing Slips
   * Demonstrates: combining saga pattern for workflow orchestration with routing slips for complex operations
   */
  async testHybridPattern(): Promise<any> {
    const orderId = uuidv7();

    try {
      await this.hybridPatternService.submitOrder(
        orderId,
        'customer_456',
        'customer@example.com',
        299.99,
        [
          { sku: 'WIDGET-001', quantity: 3 },
          { sku: 'GADGET-002', quantity: 1 },
          { sku: 'TOOL-003', quantity: 2 }
        ]
      );

      return {
        success: true,
        message: 'Hybrid pattern demonstration started',
        orderId,
        pattern: {
          saga: {
            description: 'Manages high-level order fulfillment workflow',
            states: ['Submitted', 'Fulfilling', 'Shipping', 'Completed']
          },
          routingSlip: {
            description: 'Handles multi-step fulfillment process within saga',
            activities: ['PickItems', 'PackItems', 'GenerateShippingLabel', 'QualityCheck'],
            compensation: 'Each activity can be undone if a later step fails'
          }
        },
        note: 'Check the logs to see the saga state transitions and routing slip execution'
      };
    } catch (error) {
      return {
        success: false,
        message: 'Hybrid pattern execution failed',
        orderId,
        error: error.message
      };
    }
  }
}
