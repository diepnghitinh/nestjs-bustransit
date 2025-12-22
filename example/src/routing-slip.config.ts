/**
 * Routing Slip Configuration
 *
 * This file MUST be imported FIRST in app.module.ts to ensure the mode is set
 * before BusTransit configurator runs.
 */

import { RoutingSlipExecutionMode, RoutingSlipModeRegistry } from 'nestjs-bustransit';

// Choose your execution mode:
//
// InProcess Mode (default):
// - Activities execute directly via method calls
// - No RabbitMQ queues created
// - Fast, simple, single-process
// RoutingSlipModeRegistry.setMode(RoutingSlipExecutionMode.InProcess);

// Distributed Mode:
// - Activities execute via RabbitMQ queues
// - Queues: {queuePrefix}_{activity-name}_execute, {queuePrefix}_{activity-name}_compensate
// - Horizontal scaling, fault tolerance, cross-service support
RoutingSlipModeRegistry.setMode(RoutingSlipExecutionMode.Distributed, 'myapp');
