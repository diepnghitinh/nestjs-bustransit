import {Injectable, Inject, Logger} from '@nestjs/common';
import { BUSTRANSIT_MODULE_OPTIONS } from './bustransit.constants';
import {IBusTransitBrokerOptions} from "@core/bustransit/interfaces/brokers/bustransit-broker.options.interface";
import {BusTransitBrokerFactory} from "@core/bustransit/factories/brokers/bustransit-broker";

@Injectable()
export class BusTransitService {

  constructor(@Inject(BUSTRANSIT_MODULE_OPTIONS) options: IBusTransitBrokerOptions) {
    this.createClient(options);
  }

  createClient(options: IBusTransitBrokerOptions) {
    const brokerFactory = new BusTransitBrokerFactory();
    const broker = brokerFactory.createInstance(options);
    broker?.start();
  }
}