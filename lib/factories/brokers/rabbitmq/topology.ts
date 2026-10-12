import { Logger } from '@nestjs/common';
import { EndpointRegistrationConfigurator } from '../../endpoint.registration.configurator';
import { BusTransitStateMachine } from '../../saga.bustransit.state-machine';
import type { Publisher } from './publisher';

/** An exchange to declare and, when bindTo is set, the exchange it forwards to. Names without the cluster prefix. */
export interface ExchangeDeclaration {
    exchange: string;
    bindTo: string | null;
}

export interface TopologyMaps {
    classConsumerToEndpoint: Record<string, string>;
    classMessageToEndpoint: Record<string, any>;
    classMessageToExchange: Record<string, string>;
}

/**
 * The exchanges and bindings 0.3.x declared in startAllConsumer and createAllExchange, in the same
 * order, filling the same routing maps. Pure apart from the maps it fills.
 */
export function buildTopology(
    consumers: Record<string, any>,
    consumersToEndpoint: Record<string, { consumer: any }>,
    resolve: (token: unknown) => any,
    maps: TopologyMaps,
): ExchangeDeclaration[] {
    const fromEndpoints: ExchangeDeclaration[] = [];
    for (const [queueName, cfg] of Object.entries(consumersToEndpoint)) {
        const consumer = cfg.consumer;
        let messageClass: any;
        try {
            messageClass = resolve(consumer).GetMessageClass;
        } catch (err) {
            Logger.error(`[RabbitMQ] Consumer ${consumer?.name} for queue '${queueName}' is not registered as a provider; its exchanges are skipped: ${err.message}`);
            continue;
        }
        fromEndpoints.push({ exchange: messageClass?.name, bindTo: queueName });
        maps.classConsumerToEndpoint[consumer?.name] = queueName;
        maps.classMessageToExchange[messageClass?.name] = queueName;
    }

    const fromSagas: ExchangeDeclaration[] = [];
    for (const consumerData of Object.values(consumers)) {
        const consumer = consumerData?.machineClass || consumerData;
        let instance: any;
        try {
            instance = resolve(consumer);
        } catch (err) {
            Logger.error(`[RabbitMQ] Consumer ${consumer?.name} is not registered as a provider; its exchanges are skipped: ${err.message}`);
            continue;
        }
        if (consumer.EndpointRegistrationConfigurator) {
            maps.classMessageToEndpoint[instance.GetMessageClass.name] = consumer.EndpointRegistrationConfigurator;
        }
        if (Object.getPrototypeOf(consumer) !== BusTransitStateMachine) continue;

        const saga = instance as BusTransitStateMachine<any>;
        fromSagas.push({ exchange: saga.GetMessageClass.name, bindTo: null });
        for (const event of Object.keys(saga.GetEvents)) {
            if (!maps.classMessageToEndpoint[event]) {
                const endpoint = new EndpointRegistrationConfigurator();
                endpoint.Name = maps.classMessageToExchange[saga.GetMessageClass.name];
                maps.classMessageToEndpoint[event] = endpoint;
            }
            fromSagas.push({ exchange: event, bindTo: maps.classMessageToEndpoint[event].Name ?? null });
        }
        for (const behaviour of Object.keys(saga.GetBehaviours)) {
            fromSagas.push({ exchange: behaviour, bindTo: null });
        }
    }

    return [...fromSagas, ...fromEndpoints];
}

/** Declares each exchange and binding; a refused one is logged and the rest still get declared. */
export async function declareTopology(
    publisher: Pick<Publisher, 'ensureExchange' | 'bindExchange'>,
    declarations: ExchangeDeclaration[],
    prefix: (name: string) => string,
): Promise<void> {
    for (const { exchange, bindTo } of declarations) {
        if (!exchange) {
            Logger.warn('[RabbitMQ] Skipped an exchange without a name: a consumer has no message class');
            continue;
        }
        try {
            await publisher.ensureExchange(prefix(exchange));
            if (bindTo) {
                await publisher.ensureExchange(prefix(bindTo));
                await publisher.bindExchange(prefix(bindTo), prefix(exchange));
            }
        } catch (err) {
            const target = bindTo ? ` -> '${prefix(bindTo)}'` : '';
            Logger.error(`[RabbitMQ] Could not declare exchange '${prefix(exchange)}'${target}: ${err.message}`);
        }
    }
}
