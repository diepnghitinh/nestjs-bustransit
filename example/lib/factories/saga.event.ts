import {IEvent} from "../interfaces/saga";

export class SagaEvent<TEvent> implements IEvent<TEvent> {

    Name: string;
    Value: TEvent;

    constructor(eventClass: { new(...args: any[]): TEvent }) {
        this.Name = eventClass.name;
    }

}