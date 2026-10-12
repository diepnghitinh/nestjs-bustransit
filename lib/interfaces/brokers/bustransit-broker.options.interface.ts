import type { ReliabilityOptions } from '../../factories/brokers/rabbitmq/reliability-options';

export interface IBusTransitModuleOptions {
}

export interface IBusTransitBrokerOptions {
    brokerName: string;
    brokerType: string;
    brokerInfo: any;
    reliability?: Partial<ReliabilityOptions>;
}
