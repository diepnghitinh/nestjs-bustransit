import {BrokerEnum} from "@core/bustransit/interfaces/enums";
import {BusTransitBrokerBaseFactory} from "@core/bustransit/factories/brokers/bustransit-broker.base";
import {BusTransitBrokerRabbitMqFactory} from "@core/bustransit/factories/brokers/bustransit-broker.rabbitmq";
import {IBusTransitBrokerOptions} from "@core/bustransit/interfaces/brokers/bustransit-broker.options.interface";

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