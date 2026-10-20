import type { Plan, Prisma } from '@prisma/client';

export type PlanLimits = Pick<Plan, 'patientLimit' | 'messageLimitPerCycle' | 'userLimit' | 'unitLimit' | 'connectionLimit' | 'activeAutomationLimit' | 'campaignLimitPerCycle'>;
const keys: (keyof PlanLimits)[] = ['patientLimit', 'messageLimitPerCycle', 'userLimit', 'unitLimit', 'connectionLimit', 'activeAutomationLimit', 'campaignLimitPerCycle'];

export function resolvePlanLimits(plan: PlanLimits, overrides: Prisma.JsonValue | null | undefined): PlanLimits {
  const value = overrides && typeof overrides === 'object' && !Array.isArray(overrides) ? overrides as Record<string, unknown> : {};
  const result = { ...plan };
  for (const key of keys) {
    const override = value[key];
    if (key === 'patientLimit' && override === null) result[key] = null;
    else if (Number.isSafeInteger(override) && (override as number) >= 0) result[key] = override as number;
  }
  return result;
}

export function limitsToJson(limits: Partial<PlanLimits>): Prisma.InputJsonObject {
  return Object.fromEntries(Object.entries(limits).filter(([key]) => keys.includes(key as keyof PlanLimits))) as Prisma.InputJsonObject;
}
