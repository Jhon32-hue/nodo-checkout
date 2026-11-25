import { Check, Column, Entity, Unique } from 'typeorm';
import { PersistedEntity } from '../../../infrastructure/database/persisted.entity';

@Entity('checkout_sessions')
@Unique('uq_checkout_sessions_token', ['tokenDigest'])
@Check('ck_checkout_sessions_digest', 'octet_length(token_digest) = 32')
export class CheckoutSessionOrmEntity extends PersistedEntity {
  @Column({ name: 'token_digest', type: 'bytea' })
  tokenDigest!: Buffer;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt!: Date;
}
