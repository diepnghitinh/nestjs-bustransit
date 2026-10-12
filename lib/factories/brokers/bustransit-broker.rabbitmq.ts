import { Injectable, Logger } from '@nestjs/common';
import type { Channel } from 'amqplib';
import * as os from 'os';
import { v7 as uuidv7 } from 'uuid';
import { IBusTransitBrokerOptions } from '../../interfaces/brokers/bustransit-broker.options.interface';
import { BusTransitHealth } from '../../interfaces/brokers/bustransit-health.interface';
import { IMessage } from '../../interfaces/message.interface';
import { addMilliseconds } from '../../utils/date';
import { BehaviorContext } from '../behavior.context';
import { ConsumerConfigurator } from '../consumer.configurator';
import { BusTransitBrokerBaseFactory } from './bustransit-broker.base';
import { buildConnectOptions } from './rabbitmq/connection-options';
import { ConnectionManager } from './rabbitmq/connection-manager';
import { ConsumerRunner } from './rabbitmq/consumer-runner';
import { probeDelayedMessagePlugin } from './rabbitmq/delayed-plugin-probe';
import { createDeliveryHandler } from './rabbitmq/delivery-pipeline';
import { isNotFound } from './rabbitmq/errors';
import { Publisher } from './rabbitmq/publisher';
import { ReliabilityOptions, resolveReliability } from './rabbitmq/reliability-options';
import { REPLY_QUEUE, RequestClient } from './rabbitmq/request-client';
import { TopologyRefreshSession } from './rabbitmq/topology-refresh';
import { withTimeout } from '../../utils/deferred';
import { buildTopology, declareTopology, ExchangeDeclaration } from './rabbitmq/topology';

@Injectable()
export class BusTransitBrokerRabbitMqFactory extends BusTransitBrokerBaseFactory {
    brokerName = 'RabbitMq';
    brokerConfig: IBusTransitBrokerOptions;
    private channelProducer = '_producer';
    private reliability: ReliabilityOptions = resolveReliability();
    private manager: ConnectionManager | null = null;
    private publisher: Publisher | null = null;
    private requests: RequestClient | null = null;
    private readonly runners = new Map<string, ConsumerRunner>();
    private delayedMessagePluginSupported = false;
    private queueRedeliveryEnabled = new Map<string, boolean>();
    /** Set when stopConsuming() starts: a message that fails from then on goes back to its queue instead of being parked. */
    private consumersStopping = false;
    /** Aborts a delayed-plugin probe in progress, so shutdown does not wait for it. */
    private probeAbort: AbortController | null = null;
    private declarations: ExchangeDeclaration[] = [];
    private topologyTimer: NodeJS.Timeout | null = null;
    private refreshingTopology = false;
    /** The refresh in progress, so stopConsuming() can end it. */
    private refreshSession: TopologyRefreshSession | null = null;

    public setBrokerConfig(brokerConfig: IBusTransitBrokerOptions) {
        this.brokerConfig = brokerConfig;
        this.reliability = resolveReliability(brokerConfig.reliability);
        // Built here, not in start(), so a publish made before bootstrap waits for the connection
        // (up to readyTimeoutMs) instead of failing.
        this.manager = new ConnectionManager(
            buildConnectOptions(brokerConfig.brokerInfo),
            brokerConfig.brokerName,
            this.reliability,
            () => this.onConnected(),
        );
        this.manager.onDisconnected(() => this.clearTopologyRefresh());
        this.publisher = new Publisher(this.manager, this.reliability);
        this.requests = new RequestClient(this.manager, this.reliability);
    }

    public async start(): Promise<void> {
        await this.requireManager().start();
    }

    /** Stops taking messages and waits for those in progress. Final: no consumer starts after it. Publishing keeps working until close(). */
    public async stopConsuming(): Promise<void> {
        if (!this.manager) return;
        this.consumersStopping = true;
        this.clearTopologyRefresh();
        this.probeAbort?.abort();
        // A refresh blocked on a frozen broker must not log a failure for every remaining declaration once the socket drops.
        void this.refreshSession?.end();
        // ConsumerRunner.stop() is idempotent, so close() after stopConsuming() does not wait for the drain again.
        await Promise.all([...this.runners.values()].map((runner) => runner.stop(this.reliability.shutdownTimeoutMs)));
    }

    public async close(): Promise<void> {
        if (!this.manager) return;
        await this.stopConsuming();
        await this.manager.close();
    }

    public health(): BusTransitHealth {
        return {
            connected: this.manager?.isConnected ?? false,
            blocked: this.manager?.isBlocked ?? false,
            consumers: Object.fromEntries([...this.runners].map(([queue, runner]) => [queue, runner.status])),
        };
    }

    public isDelayedMessagePluginSupported(): boolean {
        return this.delayedMessagePluginSupported;
    }

    public isRedeliveryEnabledForQueue(queueName: string): boolean {
        return this.queueRedeliveryEnabled.get(queueName) ?? false;
    }

    // Message functions
    async publish<TMessage>(message: TMessage, ctx?: BehaviorContext<any, TMessage>): Promise<void> {
        await this.requireManager().whenReady();
        const exchange = this.getNameAddClusterPrefix(
            this.classMessageToExchange[message.constructor.name] ??
            this.classMessageToEndpoint[message.constructor.name]?.Name ??
            message.constructor.name,
        );
        const msg = {
            messageId: uuidv7(),
            type: 'publish',
            sourceAddress: `rabbitmq://${this.brokerConfig.brokerInfo.host}/${this.channelProducer}`,
            destinationAddress: `rabbitmq://${this.brokerConfig.brokerInfo.host}/exchange/${exchange}`,
            messageType: `message:${this.brokerConfig.brokerName}:${message.constructor.name}`,
            message: message,
            sentTime: new Date().toString(),
            expirationTime: null,
            headers: {
                saga: ctx?.Saga,
            },
        } as IMessage<any>;
        await this.requirePublisher().publishToExchange(exchange, msg, { messageId: msg.messageId });
    }

    async publishAsync<TMessage>(message: TMessage, ctx?: BehaviorContext<any, TMessage>): Promise<any> {
        await this.requireManager().whenReady();
        const classMessage = this.classMessageToEndpoint[message.constructor.name];
        const endpoint = classMessage?.EndpointRegistrationConfigurator?.Name ?? classMessage?.Name ?? message.constructor.name;
        const msg = {
            messageId: uuidv7(),
            type: 'publishAsync',
            sourceAddress: `rabbitmq://${this.brokerConfig.brokerInfo.host}/${REPLY_QUEUE}`,
            destinationAddress: `rabbitmq://${this.brokerConfig.brokerInfo.host}/queue/${endpoint ?? ''}`,
            messageType: `message:${this.brokerConfig.brokerName}:${message.constructor.name}`,
            message: message,
            sentTime: new Date().toString(),
            expirationTime: addMilliseconds(new Date(), this.reliability.sendTimeoutMs).toString(),
            headers: {
                saga: ctx?.Saga,
            },
        } as IMessage<any>;
        Logger.debug(`[x] Sent msg to ${endpoint}, replyTo ${REPLY_QUEUE}`);
        if (!this.requests) throw new Error('[RabbitMQ] Broker is not configured');
        return this.requests.send(endpoint, msg, message.constructor.name);
    }

    private async onConnected(): Promise<void> {
        const publisher = this.requirePublisher();
        await publisher.open();

        // Fills the routing maps publish()/publishAsync() read, so it runs even when shutdown has begun:
        // publishing keeps working until close(). Only the declaring, the consumers and the refresh are skipped then.
        const declarations = buildTopology(this.consumers, this.consumersToEndpoint, (token) => this.moduleRef.get(token as any), {
            classConsumerToEndpoint: this.classConsumerToEndpoint,
            classMessageToEndpoint: this.classMessageToEndpoint,
            classMessageToExchange: this.classMessageToExchange,
        });
        this.declarations = declarations;

        // Shutdown began before the probe: skip it rather than start a connection to abort.
        if (this.consumersStopping) return;
        const probe = new AbortController();
        this.probeAbort = probe;
        let supported: boolean;
        try {
            supported = await probeDelayedMessagePlugin(
                buildConnectOptions(this.brokerConfig.brokerInfo),
                this.brokerConfig.brokerName,
                this.reliability.readyTimeoutMs,
                probe.signal,
            );
        } finally {
            if (this.probeAbort === probe) this.probeAbort = null;
        }
        // Shutdown began during the probe: its answer (false when aborted) says nothing about the broker, and no
        // consumer will start, so declare nothing. Publishing still declares what it needs lazily.
        if (this.consumersStopping) return;
        this.delayedMessagePluginSupported = supported;
        if (this.delayedMessagePluginSupported) {
            Logger.log('[RabbitMQ] ✓ x-delayed-message plugin is available');
        } else {
            Logger.warn(
                '[RabbitMQ] ⚠ WARNING: x-delayed-message plugin is NOT installed or not enabled. ' +
                'Delayed redelivery will not work. ' +
                'Please install the plugin: https://github.com/rabbitmq/rabbitmq-delayed-message-exchange',
            );
        }

        await declareTopology(publisher, declarations, (name) => this.getNameAddClusterPrefix(name));

        // Shutdown began while this setup was running (e.g. SIGTERM before the first connection was ready):
        // start no consumer. Checked right before the runners are created, with no await in between, so
        // stopConsuming() either sees every runner or this check sees the flag.
        if (this.consumersStopping) return;
        for (const [queueName, cfg] of Object.entries(this.consumersToEndpoint)) {
            if (!this.runners.has(queueName)) {
                this.runners.set(queueName, this.createRunner(queueName, cfg as ConsumerConfigurator));
            }
        }
        // Each runner handles its own failures; one bad queue never fails the connection setup.
        await Promise.all([...this.runners.values()].map((runner) => runner.start()));
        this.scheduleTopologyRefresh();
    }

    private scheduleTopologyRefresh(): void {
        this.clearTopologyRefresh();
        // `current`, not `isConnected`: the manager reports connected only after this setup returns.
        if (this.consumersStopping || !this.manager?.current) return;
        this.topologyTimer = setTimeout(() => {
            this.topologyTimer = null;
            void this.refreshTopology().finally(() => this.scheduleTopologyRefresh());
        }, this.reliability.topologyRefreshMs);
        this.topologyTimer.unref();
    }

    private clearTopologyRefresh(): void {
        if (this.topologyTimer) clearTimeout(this.topologyTimer);
        this.topologyTimer = null;
    }

    /**
     * Declares every exchange and binding of this process again: an operator may have deleted some since.
     * Runs on throwaway channels and leaves the publisher's caches alone, so it cannot disturb anything
     * else. An existing exchange is used as it is; only a missing one is created. One refresh at a time,
     * bounded by readyTimeoutMs; a refresh that times out is abandoned and the next tick tries again.
     */
    private async refreshTopology(): Promise<void> {
        if (this.refreshingTopology || this.consumersStopping || !this.manager?.isConnected) return;
        this.refreshingTopology = true;
        let session: TopologyRefreshSession;
        try {
            session = this.requirePublisher().createRefreshSession();
        } catch (err) {
            this.refreshingTopology = false;
            Logger.warn(`[RabbitMQ] Topology refresh failed: ${err.message}`);
            return;
        }
        this.refreshSession = session;
        const work = this.declareAgain(session).finally(() => {
            this.refreshingTopology = false;
        });
        const budget = this.reliability.readyTimeoutMs;
        try {
            await withTimeout(work, budget, `[RabbitMQ] Topology refresh did not finish within ${budget}ms`);
        } catch (err) {
            Logger.warn(`[RabbitMQ] Topology refresh failed: ${err.message}`);
        } finally {
            await session.end();
            if (this.refreshSession === session) this.refreshSession = null;
        }
    }

    private async declareAgain(session: TopologyRefreshSession): Promise<void> {
        const prefix = (name: string) => this.getNameAddClusterPrefix(name);
        const fanout = (name: string) => (channel: Channel) => channel.assertExchange(name, 'fanout', { durable: true });
        const seen = new Set<string>();
        for (const { exchange, bindTo } of this.declarations) {
            if (!exchange) continue;
            const key = `${exchange}->${bindTo ?? ''}`;
            if (seen.has(key)) continue;
            seen.add(key);
            await session.attempt(`exchange '${prefix(exchange)}'${bindTo ? ` -> '${prefix(bindTo)}'` : ''}`, async () => {
                await session.exchangeIfMissing(prefix(exchange), fanout(prefix(exchange)));
                if (bindTo) {
                    await session.exchangeIfMissing(prefix(bindTo), fanout(prefix(bindTo)));
                    await session.bindExchange(prefix(bindTo), prefix(exchange));
                }
            });
        }
        for (const queueName of this.runners.keys()) {
            const queueExchange = prefix(queueName);
            await session.attempt(`queue '${queueName}'`, async () => {
                await session.exchangeIfMissing(queueExchange, fanout(queueExchange));
                await session.bindQueue(queueName, queueExchange);
            });
            if (!this.queueRedeliveryEnabled.get(queueName)) continue;
            const delayExchange = prefix(`delayed.exchange.${queueName}`);
            await session.attempt(`delay exchange of queue '${queueName}'`, async () => {
                await session.exchangeIfMissing(delayExchange, (channel) =>
                    channel.assertExchange(delayExchange, 'x-delayed-message', {
                        autoDelete: false,
                        durable: true,
                        arguments: { 'x-delayed-type': 'direct' },
                    }),
                );
                await session.bindQueue(queueName, delayExchange);
            });
        }
    }

    private createRunner(queueName: string, cfg: ConsumerConfigurator): ConsumerRunner {
        const options = (cfg.options ?? {}) as { PrefetchCount?: number };
        const queueExchange = this.getNameAddClusterPrefix(queueName);
        const delayExchange = this.getNameAddClusterPrefix(`delayed.exchange.${queueName}`);
        const publisher = this.requirePublisher();
        return new ConsumerRunner(
            {
                queue: queueName,
                prefetch: options.PrefetchCount ?? 50,
                prepare: async (channel) => {
                    await publisher.ensureExchange(queueExchange);
                    await channel.assertQueue(queueName, { durable: true });
                    try {
                        await channel.bindQueue(queueName, queueExchange, '');
                    } catch (err) {
                        // The exchange was deleted behind the declaration cache: declare it again on the next start.
                        if (isNotFound(err)) publisher.forgetExchange(queueExchange);
                        throw err;
                    }
                    await this.setupRedelivery(queueName, cfg.redeliveryPattern, delayExchange);
                },
                handle: createDeliveryHandler({
                    queue: queueName,
                    consumer: cfg.consumer,
                    retryPattern: cfg.retryPattern,
                    redeliveryPattern: cfg.redeliveryPattern,
                    redeliveryEnabled: () => this.queueRedeliveryEnabled.get(queueName) ?? false,
                    delayExchange,
                    resolve: (token) => this.moduleRef.get(token as any),
                    publisher,
                    hostInfo: () => this.getSystemInfo(),
                    requeueDelayMs: this.reliability.reconnectDelayMs,
                    stopping: () => this.consumersStopping,
                }),
            },
            this.requireManager(),
            this.reliability,
        );
    }

    private async setupRedelivery(queueName: string, redeliveryPattern: unknown, delayExchange: string): Promise<void> {
        if (!redeliveryPattern) {
            this.queueRedeliveryEnabled.set(queueName, false);
            return;
        }
        if (!this.delayedMessagePluginSupported) {
            this.queueRedeliveryEnabled.set(queueName, false);
            Logger.warn(
                `[RabbitMQ] Redelivery pattern configured for queue '${queueName}' but x-delayed-message plugin is NOT available. ` +
                'Redelivery is DISABLED. Install plugin: https://github.com/rabbitmq/rabbitmq-delayed-message-exchange',
            );
            return;
        }
        const publisher = this.requirePublisher();
        // The delay exchange is asserted strictly here (a 406 disables redelivery), while the topology refresh
        // only re-asserts it when it is missing: an exchange that exists with other arguments (e.g. a delay
        // exchange that is not 'x-delayed-message' with 'x-delayed-type: direct') cannot do delayed delivery,
        // so disabling redelivery for the queue is right. The refresh only runs for queues whose redelivery
        // got enabled here.
        const declareAndBind = async () => {
            // Asserted on every consumer start, not from the cache: an operator may have deleted it since.
            // Bound on the topology channel, so a refused bind never closes the consumer's channel.
            publisher.forgetExchange(delayExchange);
            await publisher.declareDelayedExchange(delayExchange);
            await publisher.bindQueue(queueName, delayExchange);
        };
        try {
            try {
                await declareAndBind();
            } catch (error) {
                // The shared topology channel may have been closed by another declaration's refusal: then this
                // error carries no broker reply code of its own, and a second try on a fresh channel works.
                if (typeof error?.code === 'number') throw error;
                Logger.warn(`[RabbitMQ] Setting up redelivery for queue '${queueName}' failed (${error.message}); trying once more`);
                await declareAndBind();
            }
            this.queueRedeliveryEnabled.set(queueName, true);
            Logger.log(`[RabbitMQ] ✓ Redelivery enabled for queue '${queueName}'`);
        } catch (error) {
            this.queueRedeliveryEnabled.set(queueName, false);
            Logger.error(`[RabbitMQ] ✗ Could not set up redelivery for queue '${queueName}': ${error.message}. Redelivery is DISABLED.`);
        }
    }

    private requireManager(): ConnectionManager {
        if (!this.manager) throw new Error('[RabbitMQ] Broker is not configured');
        return this.manager;
    }

    private requirePublisher(): Publisher {
        if (!this.publisher) throw new Error('[RabbitMQ] Broker is not configured');
        return this.publisher;
    }

    private getSystemInfo() {
        return {
            machineName: os.hostname(),
            processName: process.title,
            processId: process.pid,
            frameworkVersion: process.version,
            operatingSystemVersion: `${os.type()} ${os.release()}`,
        };
    }

    protected getNameAddClusterPrefix(name: string) {
        return `${this.brokerConfig.brokerName ? `${this.brokerConfig.brokerName}:` : ''}${name}`;
    }
}
