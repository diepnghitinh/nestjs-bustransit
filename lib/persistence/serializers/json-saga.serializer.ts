import { Injectable } from '@nestjs/common';
import { ISagaSerializer } from '../../interfaces/saga-serializer.interface';
import { SagaStateMachineInstance } from '../../factories/saga.state-machine-instance';

/**
 * Default JSON serializer for saga state
 * Handles Date objects and preserves prototype chain on deserialization
 */
@Injectable()
export class JsonSagaSerializer implements ISagaSerializer {
    /**
     * Serialize saga to plain object
     * Converts Date objects to ISO strings
     */
    serialize<TSaga extends SagaStateMachineInstance>(saga: TSaga): any {
        // Extract all enumerable properties
        const serialized = { ...saga };

        // Handle special types
        Object.keys(serialized).forEach(key => {
            const value = serialized[key];

            // Convert Date to ISO string
            if (value instanceof Date) {
                serialized[key] = value.toISOString();
            }
            // Handle nested objects recursively
            else if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
                serialized[key] = this.serializeObject(value);
            }
        });

        return serialized;
    }

    /**
     * Deserialize stored data to saga instance
     * Restores Date objects and prototype chain
     */
    deserialize<TSaga extends SagaStateMachineInstance>(
        data: any,
        stateClass: new (...args: any[]) => TSaga
    ): TSaga {
        // Create instance with proper prototype
        const instance = new stateClass();

        // Copy all properties
        Object.assign(instance, data);

        // Restore Date objects (detect ISO date strings)
        Object.keys(instance).forEach(key => {
            const value = instance[key];

            // Restore Date from ISO string
            if (typeof value === 'string' && this.isISODateString(value)) {
                instance[key] = new Date(value);
            }
            // Handle nested objects recursively
            else if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
                instance[key] = this.deserializeObject(value);
            }
        });

        return instance;
    }

    /**
     * Recursively serialize nested objects
     */
    private serializeObject(obj: any): any {
        const serialized = { ...obj };

        Object.keys(serialized).forEach(key => {
            const value = serialized[key];

            if (value instanceof Date) {
                serialized[key] = value.toISOString();
            } else if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
                serialized[key] = this.serializeObject(value);
            }
        });

        return serialized;
    }

    /**
     * Recursively deserialize nested objects
     */
    private deserializeObject(obj: any): any {
        const deserialized = { ...obj };

        Object.keys(deserialized).forEach(key => {
            const value = deserialized[key];

            if (typeof value === 'string' && this.isISODateString(value)) {
                deserialized[key] = new Date(value);
            } else if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
                deserialized[key] = this.deserializeObject(value);
            }
        });

        return deserialized;
    }

    /**
     * Check if string is an ISO 8601 date format
     */
    private isISODateString(value: string): boolean {
        // ISO 8601 format: YYYY-MM-DDTHH:mm:ss.sssZ or similar
        const isoDateRegex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z?$/;
        return isoDateRegex.test(value);
    }
}
