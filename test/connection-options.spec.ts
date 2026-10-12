import { buildConnectOptions } from '../lib/factories/brokers/rabbitmq/connection-options';

const base = { host: 'rmq', port: 5672, username: 'u', password: 'p' };

describe('buildConnectOptions', () => {
  it('drops the leading slash of the vhost, as amqplib did with the URL path', () => {
    expect(buildConnectOptions({ ...base, vhost: '/prod_linkadz' }).vhost).toBe('prod_linkadz');
  });

  it('uses the default vhost for "", "/" or a missing vhost', () => {
    expect(buildConnectOptions({ ...base, vhost: '' }).vhost).toBeUndefined();
    expect(buildConnectOptions({ ...base, vhost: '/' }).vhost).toBeUndefined();
    expect(buildConnectOptions({ ...base }).vhost).toBeUndefined();
  });

  it('keeps passwords with URL characters intact', () => {
    expect(buildConnectOptions({ ...base, password: 'p@ss:w/rd#1' }).password).toBe('p@ss:w/rd#1');
  });

  it('decodes percent-encoded credentials like the URL form did', () => {
    const options = buildConnectOptions({ ...base, username: 'svc%40corp', password: 'p%40ss' });
    expect(options.username).toBe('svc@corp');
    expect(options.password).toBe('p@ss');
  });

  it('leaves credentials out when both are empty, so amqplib uses guest/guest as before', () => {
    const options = buildConnectOptions({ host: 'rmq', username: '', password: '' });
    expect(options.username).toBeUndefined();
    expect(options.password).toBeUndefined();
  });

  it('defaults the port to 5672', () => {
    expect(buildConnectOptions({ host: 'rmq' }).port).toBe(5672);
  });
});
