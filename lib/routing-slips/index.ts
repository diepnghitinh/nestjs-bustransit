/**
 * Routing Slips Pattern Exports
 *
 * Import everything you need for routing slips from this single entry point:
 *
 * ```typescript
 * import {
 *   RoutingSlipBuilder,
 *   RoutingSlipExecutor,
 *   IActivity,
 *   IExecuteActivity,
 *   IActivityFactory,
 *   // ... etc
 * } from 'nestjs-bustransit/routing-slips';
 * ```
 */

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
export { ExecuteContext, CompensateContext } from '../factories/execute.context';
