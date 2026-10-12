import * as amqp from 'amqplib';
import { BusTransitBrokerRabbitMqFactory } from '../../lib/factories/brokers/bustransit-broker.rabbitmq';
import { IPublishEndpoint } from '../../lib/interfaces/publish-endpoint.interface';

export let RABBITMQ_URL = process.env.RABBITMQ_URL;
export let MANAGEMENT_URL = process.env.RABBITMQ_MANAGEMENT_URL;
export const describeWithBroker = RABBITMQ_URL ? describe : describe.skip;

/** A broker with the rabbitmq_delayed_message_exchange plugin enabled; its tests are skipped when unset. */
export const DELAYED_URL = process.env.RABBITMQ_DELAYED_URL;
export const DELAYED_MANAGEMENT_URL = process.env.RABBITMQ_DELAYED_MANAGEMENT_URL;
export const describeWithDelayedBroker = DELAYED_URL && DELAYED_MANAGEMENT_URL ? describe : describe.skip;

/** Points every helper of this module at another broker. Jest loads this module once per test file, so it stays local to that file. */
export function useBroker(url: string, managementUrl: string | undefined): void {
  RABBITMQ_URL = url;
  MANAGEMENT_URL = managementUrl;
}

// Track opened buses and connections for automatic cleanup
const opened: { buses: any[]; connections: any[] } = {
  buses: [],
  connections: [],
};

function brokerInfoFromUrl(raw: string) {
  const url = new URL(raw);
  return {
    host: url.hostname,
    port: Number(url.port || 5672),
    username: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    vhost: url.pathname === '/' ? '' : url.pathname,
  };
}

export function createBus(
  prefix: string,
  opts: {
    messages?: Record<string, unknown>;
    consumers?: Record<string, unknown>;
    endpoints?: Record<string, unknown>;
    instances?: Map<unknown, unknown>;
    reliability?: Record<string, number>;
  } = {},
) {
  const bus = new BusTransitBrokerRabbitMqFactory();
  bus.setBrokerConfig({
    brokerName: prefix,
    brokerType: 'RABBITMQ',
    brokerInfo: brokerInfoFromUrl(RABBITMQ_URL!),
    reliability: {
      reconnectDelayMs: 200,
      readyTimeoutMs: 5000,
      publishTimeoutMs: 5000,
      sendTimeoutMs: 5000,
      consumerRestartMaxDelayMs: 1000,
      shutdownTimeoutMs: 2000,
      ...opts.reliability,
    },
  });
  const instances = opts.instances ?? new Map();
  instances.set(IPublishEndpoint, {});
  bus.setModuleRef({
    get: (token: any) => {
      if (!instances.has(token)) throw new Error(`no instance for ${token?.name}`);
      return instances.get(token);
    },
  });
  bus.setConsumers(opts.consumers ?? {}, opts.endpoints ?? {}, opts.messages ?? {});
  opened.buses.push(bus);
  return bus;
}

export async function rawChannel() {
  const connection = await amqp.connect(RABBITMQ_URL!);
  const channel = await connection.createChannel();
  channel.on('error', () => undefined);
  opened.connections.push(connection);
  return { connection, channel };
}

function management() {
  const url = new URL(MANAGEMENT_URL!);
  const auth = 'Basic ' + Buffer.from(`${decodeURIComponent(url.username)}:${decodeURIComponent(url.password)}`).toString('base64');
  return { origin: `${url.protocol}//${url.host}`, headers: { authorization: auth } };
}

/** Closes the broker connection whose client-provided name is `name`, as an operator would. */
export async function killConnection(name: string, timeoutMs = 20000): Promise<number> {
  const { origin, headers } = management();
  const deadline = Date.now() + timeoutMs;
  // The management API lists a new connection only after its next stats refresh.
  while (Date.now() < deadline) {
    const list = (await (await fetch(`${origin}/api/connections`, { headers })).json()) as any[];
    const targets = list.filter((c) => c.client_properties?.connection_name === name);
    if (targets.length > 0) {
      for (const target of targets) {
        await fetch(`${origin}/api/connections/${encodeURIComponent(target.name)}`, { method: 'DELETE', headers });
      }
      return targets.length;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return 0;
}

/** Closes all tracked buses and connections, swallowing errors. */
export async function closeOpened(): Promise<void> {
  for (const bus of opened.buses) {
    try {
      await bus.close();
    } catch {
      // Swallow errors
    }
  }
  for (const connection of opened.connections) {
    try {
      await connection.close();
    } catch {
      // Swallow errors
    }
  }
  opened.buses = [];
  opened.connections = [];
}

/** Deletes every exchange and queue whose name starts with `prefix` in the vhost of RABBITMQ_URL. */
export async function cleanup(prefix: string): Promise<void> {
  if (!MANAGEMENT_URL) {
    console.warn('RABBITMQ_MANAGEMENT_URL is not set: test exchanges and queues are not cleaned up');
    return;
  }
  const { origin, headers } = management();
  // amqplib reads the URL path without its leading "/" as the vhost; an empty path is the default vhost "/".
  const vhost = encodeURIComponent(decodeURIComponent(new URL(RABBITMQ_URL!).pathname.slice(1)) || '/');
  for (const kind of ['exchanges', 'queues']) {
    const res = await fetch(`${origin}/api/${kind}/${vhost}`, { headers });
    if (!res.ok) {
      throw new Error(`Failed to list ${kind} from ${origin}/api/${kind}/${vhost}: ${res.status} ${res.statusText}`);
    }
    const items = (await res.json()) as any[];
    for (const item of items.filter((i) => i.name.startsWith(prefix))) {
      const deleteRes = await fetch(`${origin}/api/${kind}/${vhost}/${encodeURIComponent(item.name)}`, { method: 'DELETE', headers });
      if (!deleteRes.ok) {
        console.warn(`Failed to delete ${kind} '${item.name}': ${deleteRes.status} ${deleteRes.statusText}`);
      }
    }
  }
}

export async function eventually<T>(attempt: () => Promise<T>, timeoutMs = 15000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      return await attempt();
    } catch (err) {
      lastError = err;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }
  throw lastError;
}

/** Encoded vhost of RABBITMQ_URL, for management API paths. */
export function vhostPath(): string {
  // amqplib reads the URL path without its leading "/" as the vhost; an empty path is the default vhost "/".
  return encodeURIComponent(decodeURIComponent(new URL(RABBITMQ_URL!).pathname.slice(1)) || '/');
}

/** Calls the management API of MANAGEMENT_URL; `path` starts after "/api". */
export async function managementApi(path: string, init: { method?: string } = {}): Promise<Response> {
  const { origin, headers } = management();
  return fetch(`${origin}/api${path}`, { ...init, headers });
}
