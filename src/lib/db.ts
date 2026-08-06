import { PrismaPg } from '@prisma/adapter-pg';

import type { Config } from '@/config';
import { PrismaClient } from '@/generated/prisma/client';

export type Db = PrismaClient;

/**
 * Build the database client.
 *
 * Prisma 7 has no Rust query engine, so a driver adapter is required rather
 * than optional. Taking the connection string from config keeps `process.env`
 * confined to `src/config`, and returning a client rather than exporting a
 * singleton means the composition root decides its lifetime. See docs/adr/0003.
 */
export const createDb = (config: Config): Db => {
  const adapter = new PrismaPg({ connectionString: config.DATABASE_URL });
  return new PrismaClient({ adapter });
};
