import type { Message } from 'amqplib';
import { v7 as uuidv7 } from 'uuid';
import type { ConnectionManager } from './connection-manager';
import type { ReliabilityOptions } from './reliability-options';

export const REPLY_QUEUE = 'amq.rabbitmq.reply-to';

/** Request/reply over RabbitMQ direct reply-to, on a temporary channel that is always closed. */
export class RequestClient {
    constructor(
        private readonly connection: ConnectionManager,
        private readonly reliability: ReliabilityOptions,
    ) {}

    async send(queue: string, body: unknown, messageName: string): Promise<any> {
        await this.connection.whenReady();
        const connection = this.connection.current;
        if (!connection) throw new Error('[RabbitMQ] Not connected to broker');

        const correlationId = uuidv7();
        const timeout = this.reliability.sendTimeoutMs;
        const channel = await connection.createChannel();
        let timer: NodeJS.Timeout | undefined;
        try {
            return await new Promise((resolve, reject) => {
                channel.on('error', reject);
                channel.on('close', () => reject(new Error('[RabbitMQ] Send failed: the channel closed before a reply arrived')));
                channel.on('return', (returned: Message) =>
                    reject(new Error(
                        `[RabbitMQ] Send failed: no queue named '${returned.fields.routingKey}'. ` +
                        `Check the endpoint name configured for ${messageName}.`,
                    )),
                );
                timer = setTimeout(() => reject(new Error(`No response received after ${timeout}ms`)), timeout);

                channel
                    .consume(
                        REPLY_QUEUE,
                        (reply) => {
                            if (!reply || reply.properties.correlationId !== correlationId) return;
                            try {
                                resolve(JSON.parse(reply.content.toString()));
                            } catch (error) {
                                reject(error);
                            }
                        },
                        { noAck: true },
                    )
                    .then(() => {
                        channel.publish('', queue, Buffer.from(JSON.stringify(body), 'utf-8'), {
                            replyTo: REPLY_QUEUE,
                            correlationId,
                            persistent: true,
                            mandatory: true,
                        });
                    })
                    .catch(reject);
            });
        } finally {
            clearTimeout(timer);
            await channel.close().catch(() => undefined);
        }
    }
}
