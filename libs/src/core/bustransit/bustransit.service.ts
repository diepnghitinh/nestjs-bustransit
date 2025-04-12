import {Injectable, Inject, Logger} from '@nestjs/common';
import {BUSTRANSIT_CONSUMERS, BUSTRANSIT_MODULE_OPTIONS} from './bustransit.constants';
import {IBusTransitBrokerOptions} from "@core/bustransit/interfaces/brokers/bustransit-broker.options.interface";
import {BusTransitBrokerFactory} from "@core/bustransit/factories/brokers/bustransit-broker";
import {BusTransitBrokerBaseFactory} from "@core/bustransit/factories/brokers/bustransit-broker.base";
import {IBusTransitConsumer} from "@core/bustransit/interfaces/_consumer";

@Injectable()
export class BusTransitService {

  private broker: BusTransitBrokerBaseFactory;

  constructor(
      @Inject(BUSTRANSIT_MODULE_OPTIONS) options: IBusTransitBrokerOptions,
      @Inject(BUSTRANSIT_CONSUMERS)
      private readonly consumers: any
  ) {
    this.createClient(options);
  }

  createClient(options: IBusTransitBrokerOptions) {
    const brokerFactory = new BusTransitBrokerFactory();
    this.broker = brokerFactory.createInstance(options);
    this.broker.setConsumers(this.consumers);
    this.broker?.start();
  }

  close() {
    this.broker.close();
  }
}