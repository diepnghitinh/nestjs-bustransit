/**
 * Routing Slip Mode Detector
 * Detects the routing slip execution mode from environment or configuration
 */

import { RoutingSlipExecutionMode } from '../../constants/routing-slip.constants';

/**
 * Global storage for routing slip execution mode
 * This is set by RoutingSlipModule.forRoot() and read by BusTransit configurator
 */
class RoutingSlipModeRegistry {
    private static mode: RoutingSlipExecutionMode = RoutingSlipExecutionMode.InProcess;
    private static queuePrefix: string | undefined;

    static setMode(mode: RoutingSlipExecutionMode, queuePrefix?: string): void {
        this.mode = mode;
        this.queuePrefix = queuePrefix;
    }

    static getMode(): RoutingSlipExecutionMode {
        return this.mode;
    }

    static getQueuePrefix(): string | undefined {
        return this.queuePrefix;
    }

    static isDistributedMode(): boolean {
        return this.mode === RoutingSlipExecutionMode.Distributed;
    }
}

export { RoutingSlipModeRegistry };
