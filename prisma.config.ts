import { defineConfig } from 'prisma/config';

// No `dotenv/config` import: Bun loads .env automatically. Run Prisma through
// Bun (`bunx --bun prisma ...`) so that stays true.
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    // Run through Bun so the seed can import from `src/` with the same path
    // aliases and TypeScript the application uses.
    seed: 'bun prisma/seed.ts',
  },
  datasource: {
    url: process.env['DATABASE_URL'],
  },
});
