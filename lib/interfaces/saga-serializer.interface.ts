import { SagaStateMachineInstance } from '../factories/saga.state-machine-instance';

/**
 * Handles serialization/deserialization of saga state
 * Ensures type safety and proper handling of custom fields
 */
export interface ISagaSerializer {
    /**
     * Serialize saga to storable format
     * @param saga - Saga instance to serialize
     * @returns Serialized representation (plain object)
     */
    serialize<TSaga extends SagaStateMachineInstance>(saga: TSaga): any;

    /**
     * Deserialize stored data to saga instance
     * @param data - Serialized saga data
     * @param stateClass - Saga state class constructor
     * @returns Saga instance with proper prototype chain
     */
    deserialize<TSaga extends SagaStateMachineInstance>(
        data: any,
        stateClass: new (...args: any[]) => TSaga
    ): TSaga;
}
