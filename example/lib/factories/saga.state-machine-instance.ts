import {ISagaStateMachineInstance} from "../interfaces/saga.state-machine-instance.interface";

export interface ICompensationActivity {
    eventName: string;
    stateName: string;
    compensationData?: any;
    timestamp: Date;
}

export class SagaStateMachineInstance implements ISagaStateMachineInstance {
    CorrelationId: string;
    CurrentState: string;
    CompensationActivities?: ICompensationActivity[] = [];
    IsCompensating?: boolean = false;
}