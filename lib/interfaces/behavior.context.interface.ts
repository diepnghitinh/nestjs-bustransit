import {ISagaConsumeContext} from "./saga.consumer.interface";

export interface IBehaviorContext<TSaga, TMessage> extends ISagaConsumeContext<TSaga, TMessage> {
    Saga: TSaga;
    IsCompleted: boolean;

    Init: <T>(message: T) => Promise<void>;
}