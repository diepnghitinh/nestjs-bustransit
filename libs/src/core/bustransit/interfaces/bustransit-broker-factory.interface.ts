import {BusTransitModuleOptions_Factory} from "@core/bustransit/factories/bustransit-options";
import {IBusTransitBrokerOptions} from "@core/bustransit/interfaces/bustransit-options.interface";

export interface IBusTransitBrokerInterface {
    start(): void;
    setBrokerConfig(brokerConfig: IBusTransitBrokerOptions);
}