import {Controller, Get, Inject, Query} from '@nestjs/common';
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

  /**
   * Demo endpoint for Routing Slips Compensation pattern
   *
   * This endpoint demonstrates automatic compensation (rollback) when an activity fails.
   *
   * The routing slip will execute activities until ValidateInventory fails:
   * 1. ProcessPayment - Processes payment ✓
   * 2. ReserveInventory - Reserves inventory ✓
   * 3. ValidateInventory - Fails intentionally ✗
   *
   * When ValidateInventory fails, the routing slip automatically compensates
   * (undoes) all previously completed activities in reverse order (LIFO):
   * - Compensate ReserveInventory (release inventory)
   * - Compensate ProcessPayment (refund payment)
   *
   * Check the logs to see the compensation sequence in action.
   *
   * @returns Object showing the failure and compensation details
   */
  @Get('test-routing-slip-compensation')
  async routingSlipCompensationTest(): Promise<any> {
    try {
      const result = await this.appService.testRoutingSlipCompensation();
      return result;
    } catch (e) {
      return {
        success: false,
        message: "Routing slip compensation test failed",
        error: e.message
      };
    }
  }

  /**
   * Demo endpoint for Routing Slips with Simulated Failure Rate
   *
   * This endpoint demonstrates compensation when SendConfirmation activity fails randomly.
   *
   * Example usage:
   * - GET /test-routing-slip-failure-rate?rate=50  (50% chance of failure)
   * - GET /test-routing-slip-failure-rate?rate=100 (always fails)
   * - GET /test-routing-slip-failure-rate?rate=0   (never fails, same as success test)
   *
   * The routing slip will execute:
   * 1. ProcessPayment - Processes payment ✓
   * 2. ReserveInventory - Reserves inventory ✓
   * 3. SendConfirmation - May fail based on failure rate
   *
   * If SendConfirmation fails, automatic compensation occurs:
   * - Compensate ReserveInventory (release inventory)
   * - Compensate ProcessPayment (refund payment)
   *
   * Check the logs to see:
   * - Whether the failure was triggered
   * - The compensation sequence (if failure occurred)
   * - All activities being rolled back in reverse order
   *
   * @param rate Failure rate (0-100), defaults to 50
   * @returns Object showing execution result and compensation details
   */
  @Get('test-routing-slip-failure-rate')
  async routingSlipFailureRateTest(@Query('rate') rate?: string): Promise<any> {
    try {
      const failureRate = rate ? parseInt(rate, 10) : 50;
      const result = await this.appService.testRoutingSlipFailureRate(failureRate);
      return result;
    } catch (e) {
      return {
        success: false,
        message: "Routing slip failure rate test failed",
        error: e.message
      };
    }
  }
}
