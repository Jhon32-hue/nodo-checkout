import { Check, Column, Entity } from 'typeorm';
import { PersistedEntity } from '../../../infrastructure/database/persisted.entity';

@Entity('customers')
@Check(
  'ck_customers_text',
  "btrim(full_name) <> '' AND btrim(email) <> '' AND btrim(phone) <> ''",
)
export class CustomerOrmEntity extends PersistedEntity {
  @Column({ name: 'full_name', type: 'varchar', length: 120 })
  fullName!: string;

  @Column({ name: 'email', type: 'varchar', length: 254 })
  email!: string;

  @Column({ name: 'phone', type: 'varchar', length: 16 })
  phone!: string;
}
