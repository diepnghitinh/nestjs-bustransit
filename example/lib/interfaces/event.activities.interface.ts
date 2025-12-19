import {IEventActivityBinder} from "./event.activity-binder.interface";

export interface IEventActivities<TSaga extends object> {
    When<T>(whenClass: { new(...args: any[]): T }): IEventActivityBinder<TSaga, T>;
}