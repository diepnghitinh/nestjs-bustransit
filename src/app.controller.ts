import {Controller, Get, Inject} from '@nestjs/common';
import { AppService } from './app.service';
import {IPublishEndpoint} from "@core/bustransit/interfaces/publish-endpoint.interface";

@Controller()
export class AppController {
  constructor(
      private readonly appService: AppService,
  ) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  @Get('push')
  producerPushText(): string {
    return this.appService.getHello();
  }
}
