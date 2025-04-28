import {Inject, Injectable} from '@nestjs/common';
import {IPublishEndpoint} from "@core/bustransit/interfaces/publish-endpoint.interface";
import {OrderSubmitted} from "@infrastructure/messaging/sagas/OrderProcessingStateMachine";
import { v7 as uuidv7 } from 'uuid';
import {OrderMessage} from "@infrastructure/messaging/consumers/SubmitOrderConsumer";

@Injectable()
export class AppService {
  constructor(
      @Inject(IPublishEndpoint)
      private readonly publishEndpoint: IPublishEndpoint,
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
}
