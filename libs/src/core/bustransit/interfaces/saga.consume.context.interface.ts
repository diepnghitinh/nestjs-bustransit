import {IConsumeContext} from "@core/bustransit/interfaces/consumer.interface";

interface ISagaConsumeContext<out TSaga> extends IConsumeContext<TSaga>
{
    Saga: TSaga;
    IsCompleted: boolean;
}