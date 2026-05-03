import { PrismaClient } from '@prisma/client';
import argon2 from 'argon2';

const prisma = new PrismaClient();

async function main() {
  const seedEmail = process.env.SEED_ADMIN_EMAIL ?? 'admin@example.com';
  const seedPassword = process.env.SEED_ADMIN_PASSWORD ?? 'changeme123';
  const seedName = process.env.SEED_ADMIN_NAME ?? 'Admin';

  const existing = await prisma.authUser.findUnique({ where: { email: seedEmail } });
  if (existing) {
    console.log(`Seed user ${seedEmail} already present (id=${existing.id}); skipping.`);
  } else {
    const passwordHash = await argon2.hash(seedPassword, { type: argon2.argon2id });
    const user = await prisma.authUser.create({
      data: { email: seedEmail, name: seedName, passwordHash, role: 'admin' },
    });
    console.log(`Seed user ${user.email} created (id=${user.id}).`);
    if (seedPassword === 'changeme123') {
      console.warn('  ⚠ default password in use — change it immediately on first login');
    }
  }

  // Default subscription group: marketing (opt_out). Email templates default
  // to marketing unless they're transactional.
  const marketing = await prisma.subscriptionGroup.upsert({
    where: { name: 'marketing' },
    update: {},
    create: {
      name: 'marketing',
      channel: 'email',
      type: 'opt_out',
      description: 'Default marketing list. Subscribers can unsubscribe via the preferences center.',
    },
  });
  console.log(`Subscription group ready: ${marketing.name} (id=${marketing.id})`);

  await prisma.subscriptionGroup.upsert({
    where: { name: 'transactional' },
    update: {},
    create: {
      name: 'transactional',
      channel: 'email',
      type: 'opt_out',
      description: 'Transactional sends. Operators should rarely route through this; opt-out still honoured.',
    },
  });
}

main()
  .then(async () => prisma.$disconnect())
  .catch(async (err) => {
    console.error(err);
    await prisma.$disconnect();
    process.exit(1);
  });
