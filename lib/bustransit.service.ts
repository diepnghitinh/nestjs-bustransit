import {Injectable, Inject, Logger} from '@nestjs/common';
import {
  BUSTRANSIT_CONSUMERS,
  BUSTRANSIT_CONSUMERS_BIND_QUEUE, BUSTRANSIT_MESSSAGES_BIND_QUEUE,
  BUSTRANSIT_MODULE_OPTIONS,
} from './bustransit.constants';
import {IBusTransitBrokerOptions} from "./interfaces/brokers/bustransit-broker.options.interface";
import {BusTransitBrokerFactory} from "./factories/brokers/bustransit-broker";
import {BusTransitBrokerBaseFactory} from "./factories/brokers/bustransit-broker.base";
import {ModuleRef} from "@nestjs/core";

export class BusTransitService {

  private broker: BusTransitBrokerBaseFactory;

  constructor(
      @Inject(BUSTRANSIT_MODULE_OPTIONS)
      private readonly options: IBusTransitBrokerOptions,
      @Inject(BUSTRANSIT_CONSUMERS)
      private readonly consumers: any,
      @Inject(BUSTRANSIT_CONSUMERS_BIND_QUEUE)
      private readonly consumersBindQueue: any,
      @Inject(BUSTRANSIT_MESSSAGES_BIND_QUEUE)
      private readonly messagesBindQueue: any,

      private readonly moduleRef: ModuleRef
  ) {
    this.createClient(options);
  }

  createClient(options: IBusTransitBrokerOptions) {
    const brokerFactory = new BusTransitBrokerFactory();
    this.broker = brokerFactory.createInstance(options);
    this.broker.setModuleRef(this.moduleRef, );
    this.broker.setConsumers(this.consumers, this.consumersBindQueue, this.messagesBindQueue);
  }

  getBroker() {
    return this.broker;
  }

  startBroker() {
    this.broker?.start();
  }

  close() {
    this.broker.close();
  }
}