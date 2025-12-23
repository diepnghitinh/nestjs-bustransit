import { Schema, Document } from 'mongoose';

/**
 * Mongoose document interface for saga state
 */
export interface SagaStateDocument extends Document {
    correlationId: string;
    currentState: string;
    sagaType: string;
    data: any;
    version: number;
    createdAt: Date;
    updatedAt: Date;
    archivedAt?: Date;
}

/**
 * Mongoose schema for saga state persistence
 */
export const SagaStateSchema = new Schema({
    correlationId: {
        type: String,
        required: true,
        unique: true,
        index: true
    },
    currentState: {
        type: String,
        required: true,
        index: true
    },
    sagaType: {
        type: String,
        required: true,
        index: true
    },
    data: {
        type: Schema.Types.Mixed,
        required: true
    },
    version: {
        type: Number,
        default: 0
    },
    createdAt: {
        type: Date,
        default: Date.now
    },
    updatedAt: {
        type: Date,
        default: Date.now
    },
    archivedAt: {
        type: Date,
        default: null,
        index: true
    }
}, {
    collection: 'saga_states',
    timestamps: true
});

// Compound index for efficient queries
SagaStateSchema.index({ sagaType: 1, currentState: 1 });

// TTL index for auto-cleanup of archived sagas
// This index will automatically delete documents where archivedAt exists and is older than the TTL
// The TTL value is set when creating the model (see MongoDBSagaRepository)
