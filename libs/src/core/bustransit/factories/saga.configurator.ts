import {Logger} from "@nestjs/common";
import {RetryConfigurator, RetryLevel} from "@core/bustransit/factories/retry.configurator";
import {interval, mergeMap, of, retry, throwError} from "rxjs";
import {ConsumerConfigurator} from "@core/bustransit/factories/consumer.configurator";

export class SagaConfigurator extends ConsumerConfigurator implements ISagaConfigurator {

}