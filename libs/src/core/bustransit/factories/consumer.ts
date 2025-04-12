import {IBusTransitConsumer} from "@core/bustransit/interfaces/consumer.interface";

export abstract class BusTransitConsumer<T> implements IBusTransitConsumer<T> {
    Consume(context) {
        throw new Error("Method not implemented.");
    }
}