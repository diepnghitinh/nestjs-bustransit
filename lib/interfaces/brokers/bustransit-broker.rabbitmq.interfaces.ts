export type RabbitHandlerType = 'rpc' | 'subscribe';

export interface RabbitHandlerConfig {
    type: RabbitHandlerType;
}