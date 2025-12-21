import {Controller, Get, Inject} from '@nestjs/common';
import { AppService } from './app.service';

@Controller()
export class AppController {
  constructor(
      private readonly appService: AppService,
  ) {}

  @Get('test-consumer')
  producerPushText(): string {
    this.appService.testConsumer();
    return "ok";
  }

  @Get('test-saga')
  async sagaTest(): Promise<any> {
    try {
      const rs = await this.appService.testSaga();
      return rs;
    } catch (e) {
      return "Failed: " + e.message;
    }
  }

  /**
   * Demo endpoint for Routing Slips pattern
   *
   * This endpoint demonstrates the routing slip pattern for distributed transaction coordination.
   *
   * The routing slip will execute the following activities in sequence:
   * 1. ProcessPayment - Processes payment for the order (with compensation: refund)
   * 2. ReserveInventory - Reserves inventory items (with compensation: release)
   * 3. SendConfirmation - Sends order confirmation email
   *
   * If any activity fails, the routing slip will automatically compensate (undo)
   * all previously completed activities in reverse order (LIFO).
   *
   * Check the logs to see:
   * - Activity execution sequence
   * - Variable sharing between activities
   * - Compensation in action (if failure occurs)
   * - Event notifications
   *
   * @returns Object containing execution result and tracking information
   */
  @Get('test-routing-slip')
  async routingSlipTest(): Promise<any> {
    try {
      const result = await this.appService.testRoutingSlip();
      return result;
    } catch (e) {
      return {
        success: false,
        message: "Routing slip execution failed",
        error: e.message
      };
    }
  }
}
