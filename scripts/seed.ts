import 'dotenv/config';
import { PrismaClient, type Prisma } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { serviceDefinitions } from '../lib/services';
import { categories } from '../lib/validation';

const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
async function seed() {
  const recipient = process.env.PAYMENT_RECIPIENT ?? '';
  for (const name of categories) await db.serviceCategory.upsert({ where: { name }, update: {}, create: { name } });
  for (const service of serviceDefinitions) {
    const data = { name: service.name, description: service.description, category: service.category, kind: service.kind, providerName: 'Agentra Reference Services', status: 'ACTIVE', priceUnits: BigInt(service.priceUnits), recipient, endpointUrl: `/api/services/${service.kind}`, inputSchema: service.inputSchema as Prisma.InputJsonValue, outputSchema: service.outputSchema as Prisma.InputJsonValue, exampleInput: service.exampleInput as Prisma.InputJsonValue, exampleOutput: service.exampleOutput as Prisma.InputJsonValue, documentation: service.documentation };
    await db.agent.upsert({ where: { id: service.kind }, create: { id: service.kind, slug: service.kind, ...data }, update: data });
  }
  console.log('Seeded three real deterministic reference services; no payments or usage records were fabricated.');
}
seed().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => db.$disconnect());
