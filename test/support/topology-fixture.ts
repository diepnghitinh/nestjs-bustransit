import { BusTransitConsumer } from '../../lib/factories/consumer';
import { ConsumerConfigurator } from '../../lib/factories/consumer.configurator';
import { SagaConfigurator } from '../../lib/factories/saga.configurator';
import { BusTransitStateMachine } from '../../lib/factories/saga.bustransit.state-machine';
import { SagaStateMachineInstance } from '../../lib/factories/saga.state-machine-instance';
import { SagaEvent } from '../../lib/factories/saga.event';
import { SagaState } from '../../lib/factories/saga.state';
import { BrokerFixtureOptions, startBroker } from './broker-fixture';

export class PingMessage {
  text: string;
}

export class PingConsumer extends BusTransitConsumer<PingMessage> {
  constructor() {
    super(PingMessage);
  }
}

export class OrderState extends SagaStateMachineInstance {}
export class OrderSubmitted {
  OrderId: string;
}
export class ChargeCard {
  OrderId: string;
}

export class OrderStateMachine extends BusTransitStateMachine<OrderState> {
  Charging = new SagaState('Charging');
  OrderSubmitted = new SagaEvent(OrderSubmitted);

  constructor() {
    super(OrderState);
    this.Event(this.OrderSubmitted, (x) => x.CorrelateById((m) => m.Message.OrderId));
    this.Initially(
      this.When(OrderSubmitted)
        .PublishAsync<ChargeCard>(ChargeCard, (c) => Object.assign(new ChargeCard(), { OrderId: c.Saga.CorrelationId }))
        .TransitionTo(this.Charging),
    );
  }
}

/** One plain consumer on "ping" and one saga on "order-saga", the two shapes the broker wires. */
export function startWithTopology(extra: BrokerFixtureOptions = {}) {
  const ping = new ConsumerConfigurator();
  ping.bindQueue('ping');
  ping.bindConsumer(PingConsumer);
  ping.setOptions({ PrefetchCount: 5 });

  const saga = new SagaConfigurator();
  saga.bindQueue('order-saga');
  saga.bindConsumer(OrderStateMachine);
  saga.setOptions({ PrefetchCount: 5 });

  return startBroker({
    consumers: { PingConsumer, OrderStateMachine: { machineClass: OrderStateMachine, stateClass: OrderState } },
    endpoints: { ping, 'order-saga': saga },
    instances: new Map<unknown, unknown>([
      [PingConsumer, new PingConsumer()],
      [OrderStateMachine, new OrderStateMachine()],
    ]),
    ...extra,
  });
}
