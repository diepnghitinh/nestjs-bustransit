import {BusTransitModuleOptions_Factory} from "@core/bustransit/factories/bustransit-options";
import {IBusTransitBrokerInterface} from "@core/bustransit/interfaces/bustransit-broker-factory.interface";
import {IBusTransitBrokerOptions} from "@core/bustransit/interfaces/bustransit-options.interface";

export class BusTransitBrokerBaseFactory implements IBusTransitBrokerInterface {
    public start() {}
    public setBrokerConfig(brokerConfig: IBusTransitBrokerOptions) {}
}