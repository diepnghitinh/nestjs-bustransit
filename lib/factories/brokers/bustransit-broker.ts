import {BusTransitBrokerBaseFactory} from "./bustransit-broker.base";
import {IBusTransitBrokerOptions} from "../../interfaces/brokers/bustransit-broker.options.interface";
import {BusTransitBrokerRabbitMqFactory} from "./bustransit-broker.rabbitmq";
import {BrokerEnum} from "../../interfaces/enums";

export class BusTransitBrokerFactory
{
    private _brokerBase: BusTransitBrokerBaseFactory;

    public createInstance(brokerConfig: IBusTransitBrokerOptions) {
        switch (BrokerEnum[brokerConfig.brokerType]) {
            case BrokerEnum.RABBITMQ:
                this._brokerBase = new BusTransitBrokerRabbitMqFactory();
                break;
        }
        this._brokerBase?.setBrokerConfig(brokerConfig);
        return this._brokerBase;
    }
}