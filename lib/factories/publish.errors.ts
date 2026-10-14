export class PublishNackError extends Error {
    constructor(public readonly exchange: string, public readonly messageId: string) {
        super(`Broker nacked message ${messageId} published to exchange '${exchange}'`);
        this.name = 'PublishNackError';
    }
}

export class PublishConfirmTimeoutError extends Error {
    constructor(public readonly exchange: string, public readonly messageId: string, public readonly timeoutMs: number) {
        super(`No broker confirm for message ${messageId} published to exchange '${exchange}' after ${timeoutMs}ms`);
        this.name = 'PublishConfirmTimeoutError';
    }
}

export class PublishChannelUnavailableError extends Error {
    constructor() {
        super('RabbitMQ producer channel is not available (connecting or closed)');
        this.name = 'PublishChannelUnavailableError';
    }
}
