import type { Options } from 'amqplib';

export interface BrokerInfo {
    host: string;
    port?: number;
    vhost?: string;
    username?: string;
    password?: string;
}

/**
 * Connection options with the exact semantics of the URL the library used to build,
 * `amqp://${username}:${password}@${host}:${port}${vhost}`:
 * - amqplib took the URL path without its leading "/" as the vhost (connect.js:137), so "/prod_linkadz"
 *   means vhost "prod_linkadz" and "" or "/" mean the default vhost.
 * - amqplib ran `unescape` on URL credentials (connect.js:80-86); the same decoding is applied here.
 * - With both credentials empty amqplib used guest/guest; leaving them out keeps that.
 * Passing fields instead of a URL means "@", ":" or "/" in a password no longer break the connection.
 */
export function buildConnectOptions(info: BrokerInfo): Options.Connect {
    const path = info.vhost ?? '';
    const vhost = path.startsWith('/') ? path.slice(1) : path;
    const username = info.username ?? '';
    const password = info.password ?? '';
    const credentials = username === '' && password === ''
        ? {}
        : { username: unescape(username), password: unescape(password) };
    return {
        protocol: 'amqp',
        hostname: info.host,
        port: info.port ?? 5672,
        vhost: vhost === '' ? undefined : vhost,
        ...credentials,
    };
}
