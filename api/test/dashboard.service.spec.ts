import { describe, expect, it, vi } from 'vitest';
import { DashboardService } from '../src/dashboard/dashboard.service.js';
import { TenantContext } from '../src/security/tenant-context.js';

describe('DashboardService', () => {
  it('agrega indicadores usando somente tenant e unidades autorizadas', async () => {
    const count = vi.fn().mockResolvedValue(0);
    const prisma = {
      scoped: {
        unitMembership: { findMany: vi.fn().mockResolvedValue([{ unitId: 'unit-a' }]) },
        appointment: { findMany: vi.fn().mockResolvedValue([]), count },
        patient: { count }, conversation: { count }, task: { count },
        outboxMessage: { count }, npsSurvey: { count }, tenant: { findUnique: vi.fn().mockResolvedValue({ name: 'Clínica teste' }) },
        unit: { findMany: vi.fn().mockResolvedValue([{ id: 'unit-a', name: 'Unidade A' }]) },
      },
    };
    const context = new TenantContext();
    const service = new DashboardService(prisma as never, context);
    const result = await context.run({ tenantId: 'tenant-a', userId: 'operator-a', membershipId: 'membership-a', role: 'OPERATOR' }, () => service.overview());

    expect(result.metrics).toEqual({ appointmentsToday: 0, confirmedToday: 0, awaitingConfirmation: 0, activePatients: 0, conversationsWaitingHuman: 0, openTasks: 0, overdueTasks: 0, failedOutbox: 0, pendingNpsFollowups: 0, plannedNpsSurveys: 0 });
    expect(prisma.scoped.appointment.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ tenantId: 'tenant-a', unitId: { in: ['unit-a'] } }) }));
    expect(prisma.scoped.task.count).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ tenantId: 'tenant-a', unitId: { in: ['unit-a'] }, assignedToId: 'operator-a' }) }));
    expect(prisma.scoped.patient.count).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ unitId: { in: ['unit-a'] } }) }));
    expect(prisma.scoped.outboxMessage.count).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ patient: { unitId: { in: ['unit-a'] } } }) }));
    expect(result.units).toEqual([{ id: 'unit-a', name: 'Unidade A' }]);
  });

  it('nega filtro de unidade fora do escopo', async () => {
    const prisma = { scoped: { unitMembership: { findMany: vi.fn().mockResolvedValue([{ unitId: 'unit-a' }]) }, unit: { findFirst: vi.fn().mockResolvedValue({ id: 'unit-b' }) } } };
    const context = new TenantContext();
    const service = new DashboardService(prisma as never, context);
    await expect(context.run({ tenantId: 'tenant-a', userId: 'operator-a', membershipId: 'membership-a', role: 'OPERATOR' }, () => service.overview('unit-b'))).rejects.toMatchObject({ status: 403 });
  });
});
