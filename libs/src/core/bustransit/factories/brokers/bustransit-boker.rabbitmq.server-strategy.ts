import {
    CustomTransportStrategy,
    Server,
} from '@nestjs/microservices';
import {Inject, Logger} from "@nestjs/common";
import {isObservable} from "rxjs";
import * as net from "net";
import {SubmitOrderConsumer} from "@infrastructure/messaging/consumers/SubmitOrderConsumer";

export class BustransitBokerRabbitmqServerStrategy extends Server implements CustomTransportStrategy {
    private server: any;

    constructor(
        //@Inject(SubmitOrderConsumer) private order: SubmitOrderConsumer,
    ) {
        super();
    }

    close(): any {
    }

    async listen(callback: () => void) {

        callback();
    }


    on(event: string, callback: Function) {
        throw new Error('Method not implemented.');
    }

    unwrap<T>(): T {
        return undefined;
    }

}