import {IBehaviorContext} from "@core/bustransit/interfaces/behavior.context.interface";
import {Logger} from "@nestjs/common";
import {PublishEndpoint} from "@core/bustransit/factories/publish-endpoint";

export class BehaviorContext<TSaga, TMessage> implements IBehaviorContext<TSaga, TMessage> {
     Saga : TSaga;
     Message: TMessage;

     IsCompleted: boolean;
     destinationAddress: string;
     expirationTime: string;
     headers: any;
     messageId: string;
     messageType: string;
     sentTime: string;
     sourceAddress: string;

     producerClient: PublishEndpoint;

     async Init<T>(message: T): Promise<void> {
          Logger.debug('message');
          //this.producerClient.Publish<T>(message);
     }

     fields: any;
}