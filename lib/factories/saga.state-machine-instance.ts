import {ISagaStateMachineInstance} from "../interfaces/saga.state-machine-instance.interface";

export class SagaStateMachineInstance implements ISagaStateMachineInstance {
    CorrelationId: string;
    CurrentState: string;
}