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
}
