import {
    IRabbitMqBusFactoryConfigurator,
} from "../interfaces/bustransit-adapter.interface";
import {BusTransitModuleOptionsRabbitMq_Host_Factory} from "@core/bustransit/factories/bustransit-options";
import { BusTransitAdapterAuthConfig } from "./bustransit-adapter.auth.config";
import {BrokerEnum} from "@core/bustransit/interfaces/enums";

export class BusTransitAdapterRabbitMqConfig implements IRabbitMqBusFactoryConfigurator
{
    private prefetchCount: number = 50;
    private durable: boolean = true;
    private options = {
        brokerType: '',
        brokerInfo: {
            host: '',
            vhost: '',
            username: '',
            password: '',
            port: 5672
        }
    }

    public Host(host: string, vhost: string, h: BusTransitModuleOptionsRabbitMq_Host_Factory): any {
        const busTransitAdapterAuthConfig = new BusTransitAdapterAuthConfig();
        h(busTransitAdapterAuthConfig);
        this.options = {
            brokerType: BrokerEnum.RABBITMQ,
            brokerInfo: {
                host: host,
                vhost: vhost,
                port: 5672,
                ...busTransitAdapterAuthConfig.getOptions(),
            }
        }
    }

    public ReceiveEndpoint(queueName: string, e: any) {

    }

    public getOptions() {
        return this.options;
    }

    set PrefetchCount(value: number) {
        this.prefetchCount = value;
    }

    set Durable(value: boolean) {
        this.durable = value;
    }
}