// Seed a couple of consented sample leads so you can exercise the API end-to-end
// in dry-run mode. These use example.com addresses and a synthetic consent
// record — replace with your own consented data.
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const leads = [
    {
      email: 'dana@example.com',
      firstName: 'Dana',
      company: 'Northwind',
      title: 'Head of Ops',
      consentBasis: 'OPT_IN' as const,
      consentSource: 'Website demo request form',
      consentAt: new Date('2026-07-01T00:00:00Z'),
      attributes: { industry: 'Logistics' },
    },
    {
      email: 'sam@example.com',
      firstName: 'Sam',
      company: 'Acme',
      title: 'CTO',
      consentBasis: 'EXISTING_CUSTOMER' as const,
      consentSource: 'Active subscription since 2025',
      consentAt: new Date('2026-06-15T00:00:00Z'),
      attributes: { industry: 'SaaS' },
    },
  ];

  for (const lead of leads) {
    await prisma.lead.upsert({ where: { email: lead.email }, create: lead, update: lead });
  }
  // eslint-disable-next-line no-console
  console.log(`Seeded ${leads.length} consented sample leads.`);
}

main()
  .catch((e) => {
    // eslint-disable-next-line no-console
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
