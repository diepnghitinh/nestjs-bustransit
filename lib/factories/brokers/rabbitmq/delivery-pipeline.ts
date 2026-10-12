import { Logger } from '@nestjs/common';
import type { Channel, ConsumeMessage } from 'amqplib';
import { defer, lastValueFrom } from 'rxjs';
import { IMessage } from '../../../interfaces/message.interface';
import { IPublishEndpoint } from '../../../interfaces/publish-endpoint.interface';
import { BehaviorContext } from '../../behavior.context';
import { retryWithDelay } from '../../retry.utils';
import type { Publisher } from './publisher';

export type DeliveryHandler = (channel: Channel, message: ConsumeMessage) => Promise<void>;

export interface RedeliveryPattern {
    retryType: number;
    retryValue: any;
}

export interface DeliveryContext {
    queue: string;
    consumer: unknown;
    retryPattern?: { pipe: any };
    redeliveryPattern?: RedeliveryPattern;
    redeliveryEnabled: () => boolean;
    /** Delayed exchange of this queue, with the cluster prefix. */
    delayExchange: string;
    resolve: (token: unknown) => any;
    publisher: Pick<Publisher, 'publishRaw' | 'ensureQueue' | 'exchangeExists'>;
    hostInfo: () => object;
    /** Wait before handing a message back to the queue when it could not be parked. */
    requeueDelayMs: number;
    /** True once the bus stops consuming (shutdown): a failed message then goes back to its queue instead of being parked. */
    stopping?: () => boolean;
}

/** The message must go back to its queue: parking it now (error queue included) would lose redelivery attempts. */
class RequeueError extends Error {}

export function redeliveryDelay(pattern: RedeliveryPattern, attempt: number): { maxRetries: number; delayMs: number } {
    switch (pattern.retryType) {
        case 1: // Retry.Interval
            return { maxRetries: pattern.retryValue[0], delayMs: pattern.retryValue[1] };
        case 2: // Retry.Intervals
            return {
                maxRetries: pattern.retryValue.length,
                delayMs: attempt < pattern.retryValue.length ? pattern.retryValue[attempt] : 0,
            };
        case 3: // Retry.Exponential
            return {
                maxRetries: pattern.retryValue[0],
                delayMs: pattern.retryValue[1] * Math.pow(pattern.retryValue[2], attempt),
            };
        case 0: // Retry.Immediate
        default:
            return { maxRetries: pattern.retryValue, delayMs: 0 };
    }
}

/**
 * Handles one delivery: parse, run the consumer with in-place retries, then either ack, or park the
 * message (delayed redelivery or error queue) and ack only once the broker confirmed the parked copy.
 * If the copy cannot be written the message goes back to the queue instead of being lost.
 */
export function createDeliveryHandler(ctx: DeliveryContext): DeliveryHandler {
    // amqplib channels have no public "closed" flag; remember the ones that emitted "close".
    const watched = new WeakSet<Channel>();
    const closed = new WeakSet<Channel>();
    const isClosed = (channel: Channel) => closed.has(channel);
    return async (channel, message) => {
        if (!watched.has(channel)) {
            watched.add(channel);
            channel.once('close', () => closed.add(channel));
        }

        let body: any;
        try {
            body = JSON.parse(message.content.toString());
        } catch (err) {
            Logger.error(`[RabbitMQ] Message on '${ctx.queue}' is not valid JSON: ${err.message}`);
            await settle(ctx, channel, message, isClosed, () => moveToErrorQueue(ctx, message, message.content.toString(), err));
            return;
        }

        try {
            const retryPipe = ctx.retryPattern?.pipe ?? retryWithDelay({ maxRetryAttempts: 0, delay: 0 });
            await lastValueFrom(defer(() => invoke(ctx, channel, message, body)).pipe(retryPipe));
            ack(ctx.queue, channel, message);
        } catch (err) {
            Logger.error(`[RabbitMQ] Message on '${ctx.queue}' failed: ${err.message}`);
            if (ctx.stopping?.()) {
                // Shutdown is not a poison message (e.g. a Send whose target consumer already stopped): as 0.3.x did,
                // leave it in the queue for the next consumer instead of parking it.
                await requeue(ctx, channel, message, isClosed, 'the bus is shutting down');
                return;
            }
            await settle(ctx, channel, message, isClosed, async () => {
                try {
                    if (!(await redeliver(ctx, message, body))) {
                        await moveToErrorQueue(ctx, message, body, err);
                    }
                } catch (redeliverErr) {
                    if (redeliverErr instanceof RequeueError) throw redeliverErr;
                    Logger.error(`[RabbitMQ] Could not park a failed message from '${ctx.queue}': ${redeliverErr.message}. Trying the error queue again`);
                    await moveToErrorQueue(ctx, message, body, err);
                }
            });
        }
    };
}

async function invoke(ctx: DeliveryContext, channel: Channel, message: ConsumeMessage, body: any): Promise<any> {
    const consumer = ctx.resolve(ctx.consumer);
    consumer.producer = ctx.resolve(IPublishEndpoint);

    const behavior = new BehaviorContext<any, any>();
    behavior.Saga = body.headers?.saga;

    const result = await consumer.Consume(behavior, { ...message, Message: body.message } as unknown as IMessage<any>);

    const { replyTo, correlationId } = message.properties;
    if (replyTo && correlationId) {
        try {
            channel.publish('', replyTo, Buffer.from(JSON.stringify(result ?? true)), { correlationId });
        } catch (err) {
            // The work is done; failing here would run the consumer again. The caller times out instead.
            Logger.warn(`[RabbitMQ] Could not send the reply for a message on '${ctx.queue}': ${err.message}`);
        }
    }
    return result;
}

async function redeliver(ctx: DeliveryContext, message: ConsumeMessage, body: any): Promise<boolean> {
    const pattern = ctx.redeliveryPattern;
    if (!pattern?.retryValue) return false;
    if (!ctx.redeliveryEnabled()) {
        Logger.warn(
            `[RabbitMQ] Redelivery pattern configured but DISABLED for queue '${ctx.queue}' - ` +
            'x-delayed-message plugin not available. Message will be sent to error queue.',
        );
        return false;
    }
    const attemptHeader = message.properties.headers?.['x-redelivery'];
    const attempt = Number(attemptHeader ?? 0);
    if (!Number.isFinite(attempt) || attempt < 0) {
        Logger.warn(`[RabbitMQ] Invalid x-redelivery header '${attemptHeader}' on '${ctx.queue}'; treating redelivery attempts as exhausted`);
        return false;
    }
    const { maxRetries, delayMs } = redeliveryDelay(pattern, attempt);
    if (attempt >= maxRetries) {
        Logger.warn(`[RabbitMQ] Redelivery: Max attempts (${maxRetries}) reached for message`);
        return false;
    }
    Logger.log(`[RabbitMQ] Redelivery: Attempt ${attempt + 1}/${maxRetries}: retrying in ${delayMs}ms`);
    // Publishing to a missing exchange would close the shared producer channel, and re-creating it here would
    // leave it without the queue binding, so the plugin would drop the message. The error queue keeps it instead;
    // the consumer restores the exchange and its binding the next time it starts.
    let exists: boolean;
    try {
        exists = await ctx.publisher.exchangeExists(ctx.delayExchange);
    } catch (err) {
        // Not an answer (connection reset, timeout ...): retry the whole message later rather than spend its redelivery attempts.
        throw new RequeueError(`could not check the delay exchange '${ctx.delayExchange}': ${err.message}`);
    }
    if (!exists) {
        // exchangeExists() already dropped it from the declaration cache, so the next topology refresh (or the consumer's next start) re-creates and re-binds it.
        Logger.warn(`[RabbitMQ] Delay exchange '${ctx.delayExchange}' does not exist. Message will be sent to error queue.`);
        return false;
    }
    // No "mandatory": the delayed-message plugin does not support it.
    await ctx.publisher.publishRaw(ctx.delayExchange, '', body, {
        persistent: true,
        messageId: message.properties.messageId,
        correlationId: message.properties.correlationId,
        replyTo: message.properties.replyTo,
        headers: { ...message.properties.headers, 'x-delay': delayMs, 'x-redelivery': attempt + 1 },
    });
    return true;
}

async function moveToErrorQueue(ctx: DeliveryContext, message: ConsumeMessage, payload: unknown, err: Error): Promise<void> {
    const errorQueue = `${ctx.queue}_error`;
    const errorPayload = {
        headers: message.properties.headers,
        message: payload,
        host: ctx.hostInfo(),
        error: { stack: err.stack, message: err.message, timestamp: new Date().toISOString() },
        retryHistory: {
            immediateRetries: message.properties.headers?.['x-retry-count'] ?? 0,
            redeliveryAttempts: message.properties.headers?.['x-redelivery'] ?? 0,
        },
    };
    await ctx.publisher.ensureQueue(errorQueue);
    await ctx.publisher.publishRaw('', errorQueue, errorPayload, { persistent: true, mandatory: true, rejectIfUnroutable: true });
    Logger.error(
        `Message moved to error queue: ${errorQueue}. ` +
        `Immediate retries: ${errorPayload.retryHistory.immediateRetries}, ` +
        `Redelivery attempts: ${errorPayload.retryHistory.redeliveryAttempts}`,
    );
}

async function settle(
    ctx: DeliveryContext,
    channel: Channel,
    message: ConsumeMessage,
    isClosed: (channel: Channel) => boolean,
    park: () => Promise<void>,
): Promise<void> {
    if (isClosed(channel)) {
        // The ack could not reach the broker any more, so a parked copy would duplicate the redelivered message.
        Logger.warn(`[RabbitMQ] The channel of a failed message on '${ctx.queue}' is closed; not parking it, the broker will redeliver it`);
        return;
    }
    try {
        await park();
        ack(ctx.queue, channel, message);
    } catch (err) {
        Logger.error(`[RabbitMQ] Could not park a failed message from '${ctx.queue}': ${err.message}. It goes back to the queue in ${ctx.requeueDelayMs}ms`);
        await new Promise((resolve) => setTimeout(resolve, ctx.requeueDelayMs));
        try {
            channel.nack(message, false, true);
        } catch (nackErr) {
            Logger.warn(`[RabbitMQ] Could not requeue on '${ctx.queue}': ${nackErr.message}. The broker will redeliver the message.`);
        }
    }
}

/** Hands the message back after requeueDelayMs, like settle(), so a consumer that keeps failing never spins on it. */
async function requeue(
    ctx: DeliveryContext,
    channel: Channel,
    message: ConsumeMessage,
    isClosed: (channel: Channel) => boolean,
    reason: string,
): Promise<void> {
    if (isClosed(channel)) return; // the broker requeues it anyway
    Logger.warn(`[RabbitMQ] A failed message on '${ctx.queue}' goes back to the queue in ${ctx.requeueDelayMs}ms: ${reason}`);
    // unref(): this wait must never keep the process alive on its own once the app has shut down.
    await new Promise((resolve) => setTimeout(resolve, ctx.requeueDelayMs).unref());
    if (isClosed(channel)) return;
    try {
        channel.nack(message, false, true);
    } catch (err) {
        Logger.warn(`[RabbitMQ] Could not requeue on '${ctx.queue}': ${err.message}. The broker will redeliver the message.`);
    }
}

function ack(queue: string, channel: Channel, message: ConsumeMessage): void {
    try {
        channel.ack(message);
    } catch (err) {
        Logger.warn(`[RabbitMQ] Could not ack on '${queue}': ${err.message}. The broker will redeliver the message.`);
    }
}
