import { Body, Controller, Get, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { Roles } from '../security/security.decorators.js';
import { ResourcesService } from './resources.service.js';

@Controller('resources')
export class ResourcesController {
  constructor(private readonly service: ResourcesService) {}
  @Get() list(@Query('unitId') unitId?: string) { return this.service.list(unitId ?? ''); }
  @Post() @Roles('PLATFORM_SUPERADMIN', 'TENANT_ADMIN', 'UNIT_MANAGER') create(@Body() body: Record<string, unknown>) { return this.service.create(body); }
  @Patch(':id') @Roles('PLATFORM_SUPERADMIN', 'TENANT_ADMIN', 'UNIT_MANAGER') update(@Param('id') id: string, @Body() body: Record<string, unknown>) { return this.service.update(id, body); }
  @Put('procedure-requirements/:procedureId') @Roles('PLATFORM_SUPERADMIN', 'TENANT_ADMIN', 'UNIT_MANAGER') setRequirements(@Param('procedureId') procedureId: string, @Body() body: { unitId?: string; requirements?: unknown }) { return this.service.setProcedureRequirements(procedureId, body.unitId ?? '', body.requirements); }
}
