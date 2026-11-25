import { CreateDateColumn, PrimaryColumn, UpdateDateColumn } from 'typeorm';

// Persistence metadata only. IDs are supplied by the caller (UUID v4).
export abstract class PersistedEntity {
  @PrimaryColumn('uuid')
  id!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
