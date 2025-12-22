/**
 * Routing Slips Pattern Exports
 *
 * Import everything you need for routing slips from this single entry point:
 *
 * ```typescript
 * import {
 *   RoutingSlipBuilder,
 *   RoutingSlipExecutor,
 *   RoutingSlipModule,
 *   RoutingSlipService,
 *   RoutingSlipActivity,
 *   IActivity,
 *   IExecuteActivity,
 *   IActivityFactory,
 *   // ... etc
 * } from 'nestjs-bustransit/routing-slips';
 * ```
 */

// Module and Configuration
export {
    RoutingSlipModule,
    RoutingSlipModuleOptions
} from '../routing-slip.module';

export { RoutingSlipExecutionMode } from '../constants/routing-slip.constants';

export { RoutingSlipService } from '../services/routing-slip.service';
export { RoutingSlipQueueProvisioningService, IActivityQueueConfiguration } from '../services/routing-slip-queue-provisioning.service';

export {
    RoutingSlipActivity,
    RoutingSlipActivityOptions,
    ROUTING_SLIP_ACTIVITY_METADATA
} from '../decorators/routing-slip-activity.decorator';

export { RoutingSlipActivityFactory } from '../factories/routing-slip-activity.factory';

// Core interfaces
export {
    IRoutingSlip,
    IRoutingSlipActivity,
    IRoutingSlipVariable,
    IActivityLog,
    IActivityException,
    IRoutingSlipItinerary
} from '../interfaces/routing-slip.interface';

export {
    IActivity,
    IExecuteActivity,
    IExecuteContext,
    ICompensateContext,
    IActivityResult,
    ActivityResultType,
    IActivityFactory
} from '../interfaces/activity.interface';

export {
    IRoutingSlipEvent,
    IRoutingSlipCompleted,
    IRoutingSlipFaulted,
    IRoutingSlipCompensationFailed,
    IRoutingSlipActivityCompleted,
    IRoutingSlipActivityFaulted,
    IRoutingSlipActivityCompensated,
    IRoutingSlipTerminated,
    IRoutingSlipEventSubscriber
} from '../interfaces/routing-slip.events';

// Implementation classes
export { RoutingSlipBuilder } from '../factories/routing-slip.builder';
export { RoutingSlipExecutor } from '../factories/routing-slip.executor';
export { RoutingSlipDistributedExecutor } from '../factories/routing-slip.distributed-executor';
export { ExecuteContext, CompensateContext } from '../factories/execute.context';

// Distributed messaging
export {
    IRoutingSlipActivityExecuteMessage,
    IRoutingSlipActivityCompensateMessage,
    IRoutingSlipActivityExecuteResponse,
    IRoutingSlipActivityCompensateResponse
} from '../interfaces/routing-slip-messages.interface';

export { RoutingSlipActivityExecuteMessage } from './messages/routing-slip-activity-execute.message';
export { RoutingSlipActivityCompensateMessage } from './messages/routing-slip-activity-compensate.message';
export { RoutingSlipActivityExecuteResponseMessage } from './messages/routing-slip-activity-execute-response.message';
export { RoutingSlipActivityCompensateResponseMessage } from './messages/routing-slip-activity-compensate-response.message';

export { ActivityExecuteConsumerFactory } from './consumers/activity-execute.consumer';
export { ActivityCompensateConsumerFactory } from './consumers/activity-compensate.consumer';

// BusTransit Integration and Mode Detection
export { RoutingSlipBusConfigurator, IRoutingSlipBusConfiguration } from './helpers/routing-slip-bus-configurator';
export { RoutingSlipModeRegistry } from './helpers/routing-slip-mode-detector';
