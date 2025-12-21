/**
 * Routing Slip Builder
 * Fluent API for building routing slips
 */

import { v4 as uuidv4 } from 'uuid';
import { IRoutingSlip, IRoutingSlipActivity, IActivityLog } from '../interfaces/routing-slip.interface';

/**
 * Builder for creating routing slips with fluent API
 */
export class RoutingSlipBuilder {
    private trackingNumber: string;
    private itinerary: IRoutingSlipActivity[] = [];
    private variables: Map<string, any> = new Map();
    private createTimestamp: Date;

    constructor(trackingNumber?: string) {
        this.trackingNumber = trackingNumber || uuidv4();
        this.createTimestamp = new Date();
    }

    /**
     * Add an activity to the itinerary
     */
    addActivity(name: string, address: string, args?: any): RoutingSlipBuilder {
        this.itinerary.push({
            name,
            address,
            args: args || {}
        });
        return this;
    }

    /**
     * Add a variable to the routing slip
     */
    addVariable(key: string, value: any): RoutingSlipBuilder {
        this.variables.set(key, value);
        return this;
    }

    /**
     * Add multiple variables to the routing slip
     */
    addVariables(variables: Record<string, any>): RoutingSlipBuilder {
        Object.entries(variables).forEach(([key, value]) => {
            this.variables.set(key, value);
        });
        return this;
    }

    /**
     * Set a custom tracking number
     */
    setTrackingNumber(trackingNumber: string): RoutingSlipBuilder {
        this.trackingNumber = trackingNumber;
        return this;
    }

    /**
     * Build the routing slip
     */
    build(): IRoutingSlip {
        if (this.itinerary.length === 0) {
            throw new Error('Routing slip must have at least one activity in the itinerary');
        }

        return {
            trackingNumber: this.trackingNumber,
            createTimestamp: this.createTimestamp,
            itinerary: [...this.itinerary],
            activityLogs: [],
            compensateLogs: [],
            variables: new Map(this.variables),
            activityExceptions: []
        };
    }

    /**
     * Create a new builder instance
     */
    static create(trackingNumber?: string): RoutingSlipBuilder {
        return new RoutingSlipBuilder(trackingNumber);
    }
}
