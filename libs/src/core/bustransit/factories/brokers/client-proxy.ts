import { ClientProxy, ReadPacket, WritePacket } from '@nestjs/microservices';

export class BusTransitClientProxy extends ClientProxy {
    async connect(): Promise<any> {}
    async close() {}
    async dispatchEvent(packet: ReadPacket<any>): Promise<any> {}
    unwrap<T = never>(): T {
        throw new Error('Method not implemented.');
    }

    protected publish(packet: ReadPacket, callback: (packet: WritePacket) => void): () => void {
        console.log('message:', packet);

        // In a real-world application, the "callback" function should be executed
        // with payload sent back from the responder. Here, we'll simply simulate (5 seconds delay)
        // that response came through by passing the same "data" as we've originally passed in.
        // setTimeout(() => callback({ response: packet.data }), 5000);

        callback({ response: packet.data });

        return () => console.log('teardown');
    }
}