import { PrismaClient } from '@prisma/client';

const db = new PrismaClient();
const plans = [
  { code: 'STARTER', name: 'Starter', priceCents: 9700, patientLimit: 500, messageLimitPerCycle: 1000, userLimit: 1, unitLimit: 1, connectionLimit: 1, activeAutomationLimit: 3, campaignLimitPerCycle: 3 },
  { code: 'PROFESSIONAL', name: 'Profissional', priceCents: 19700, patientLimit: 1500, messageLimitPerCycle: 3000, userLimit: 3, unitLimit: 1, connectionLimit: 1, activeAutomationLimit: 20, campaignLimitPerCycle: 20 },
  { code: 'ENTERPRISE', name: 'Enterprise', priceCents: 39700, patientLimit: null, messageLimitPerCycle: 10000, userLimit: 10, unitLimit: 3, connectionLimit: 3, activeAutomationLimit: 100, campaignLimitPerCycle: 100 },
];

async function main() {
  for (const plan of plans) await db.plan.upsert({ where: { code: plan.code }, create: plan, update: { ...plan, enabled: true } });
  const args = new Map(process.argv.slice(2).flatMap((arg, index, all) => arg.startsWith('--') ? [[arg.slice(2), all[index + 1] ?? '']] : []));
  const tenantSlug = args.get('tenant-slug');
  const planCode = (args.get('plan') ?? 'STARTER').toUpperCase();
  if (tenantSlug) {
    const tenant = await db.tenant.findUnique({ where: { slug: tenantSlug } });
    const plan = await db.plan.findUnique({ where: { code: planCode } });
    if (!tenant || !plan) throw new Error('Tenant ou plano não encontrado.');
    const now = new Date();
    await db.subscription.upsert({
      where: { tenantId: tenant.id },
      create: { tenantId: tenant.id, planId: plan.id, status: 'TRIAL', cycleStartsAt: now, cycleEndsAt: new Date(now.getTime() + 30 * 86400000) },
      update: { planId: plan.id },
    });
    console.info(`Planos semeados; tenant ${tenantSlug} configurado no ciclo inicial de 30 dias (${planCode}).`);
  } else {
    console.info('Planos Starter, Profissional e Enterprise semeados. Passe --tenant-slug <slug> [--plan STARTER|PROFESSIONAL|ENTERPRISE] para iniciar um ciclo de teste para um tenant.');
  }
}

main().catch((error: unknown) => { console.error(error); process.exitCode = 1; }).finally(() => db.$disconnect());
