import {
    Entity,
    Column,
    PrimaryColumn,
    CreateDateColumn,
    UpdateDateColumn,
    Index
} from 'typeorm';

/**
 * TypeORM entity for saga state persistence in PostgreSQL
 */
@Entity('saga_states')
@Index(['sagaType', 'currentState'])
export class SagaStateEntity {
    @PrimaryColumn({ length: 255 })
    correlationId: string;

    @Column({ length: 100 })
    @Index()
    currentState: string;

    @Column({ length: 100 })
    @Index()
    sagaType: string;

    @Column('jsonb')
    data: any;

    @Column({ default: 0 })
    version: number;

    @CreateDateColumn()
    createdAt: Date;

    @UpdateDateColumn()
    updatedAt: Date;

    @Column({ nullable: true })
    @Index()
    archivedAt: Date | null;
}
