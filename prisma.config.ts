import 'dotenv/config';
import { defineConfig, env } from 'prisma/config';
import { PrismaPg } from '@prisma/adapter-pg';

export default defineConfig({
  experimental: { adapter: true },
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  engine: 'js',
  adapter: async () => new PrismaPg({ connectionString: env('DATABASE_URL') }),
});
