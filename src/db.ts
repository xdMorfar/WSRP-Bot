import mongoose from 'mongoose';
import { env } from './config';
import { logger } from './logger';

export async function connectDatabase() {
  mongoose.set('strictQuery', true);
  await mongoose.connect(env.mongoUri, {
    serverSelectionTimeoutMS: 15000,
    maxPoolSize: 10,
  });
  logger.info('Connected to MongoDB');
}

export async function disconnectDatabase() {
  await mongoose.disconnect();
}
