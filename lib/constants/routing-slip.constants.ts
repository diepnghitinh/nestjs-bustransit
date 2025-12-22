/**
 * Routing Slip Constants
 * Injection tokens and constants for routing slip module
 */

/**
 * Execution mode for routing slips
 */
export enum RoutingSlipExecutionMode {
    /**
     * Execute activities in-process (default)
     */
    InProcess = 'InProcess',

    /**
     * Execute activities using message queues (distributed)
     */
    Distributed = 'Distributed'
}

/**
 * Injection token for IActivityFactory
 */
export const ACTIVITY_FACTORY = Symbol('ACTIVITY_FACTORY');

/**
 * Injection token for routing slip module options
 */
export const ROUTING_SLIP_MODULE_OPTIONS = Symbol('ROUTING_SLIP_MODULE_OPTIONS');
