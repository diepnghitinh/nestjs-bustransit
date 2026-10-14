export interface IBusTransitModuleOptions {
}

import {IPublisherOptions} from "../publisher-options.interface";

export interface IBusTransitBrokerOptions {
    brokerName: string;
    brokerType: string;
    brokerInfo: any;
    publisher?: IPublisherOptions;
}