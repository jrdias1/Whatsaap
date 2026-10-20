import { Body, Controller, Get, Post } from '@nestjs/common';
import { Roles } from '../security/security.decorators.js';
import { OutboxDispatchService } from './outbox-dispatch.service.js';

@Controller('outbox/dry-run')
export class OutboxDispatchController {
  constructor(private readonly service: OutboxDispatchService) {}

  @Get('summary')
  @Roles('TENANT_ADMIN')
  summary() { return this.service.summary(); }

  @Post('dispatch')
  @Roles('TENANT_ADMIN')
  dispatch(@Body() body: Record<string, unknown>) {
    const limit = body.limit === undefined ? 250 : Number(body.limit);
    const unitId = typeof body.unitId === 'string' ? body.unitId : undefined;
    return this.service.dispatchPending(limit, unitId);
  }

  @Post('reconcile-unknown')
  @Roles('TENANT_ADMIN')
  reconcileUnknown() { return this.service.reconcileUnknown(); }
}
