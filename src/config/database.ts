import { DataSource } from 'typeorm';
import { User } from '../models/User'
import { Product } from '../models/Product'
import { Order } from '../models/Order'
import { OrderItem } from '../models/OrderItem'
import { Review } from '../models/Review'
import { Wishlist } from '../models/WishList'
import 'dotenv/config';

export const AppDataSource = new DataSource({
  type: 'postgres',
  host: process.env.DB_HOST,
  port: parseInt(process.env.DB_PORT || '5432'),
  username: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  synchronize: process.env.NODE_ENV !== 'production',
  logging: process.env.NODE_ENV !== 'production',
  entities: [User, Product, Order, OrderItem, Review, Wishlist],
  migrations: ['src/migrations/*.ts'],
});