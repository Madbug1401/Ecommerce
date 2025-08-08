import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  OneToMany,
  CreateDateColumn,
  JoinColumn
} from 'typeorm';
import { User } from './User';
import { OrderItem } from './OrderItem'

@Entity('orders')
export class Order {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @ManyToOne(() => User, (user) => user.id, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user!: User;

  @Column('uuid')
  user_id!: string;

  @Column('decimal', { precision: 10, scale: 2 })
  total!: number;

  @Column({ default: 'pending' }) // pending, paid, shipped, delivered, cancelled
  status!: string;

  @OneToMany(() => OrderItem, (orderItem) => orderItem.order, { cascade: true })
  items!: OrderItem[];

  @CreateDateColumn({ type: 'timestamp without time zone' })
  created_at!: Date;
}
