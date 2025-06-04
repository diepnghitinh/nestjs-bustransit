import {IConsumeContext} from "./consumer.interface";

export interface ISagaConsumeContext<out TSaga> extends IConsumeContext<TSaga>
{
    Saga: TSaga;
    IsCompleted: boolean;
}