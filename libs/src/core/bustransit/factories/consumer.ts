import {IBusTransitConsumer} from "@core/bustransit/interfaces/_consumer";

export abstract class BusTransitConsumer<T> implements IBusTransitConsumer<T> {
    Consume(context) {
        throw new Error("Method not implemented.");
    }
}