import { Body, Controller, Delete, Get, Param, Post, Put } from '@nestjs/common';
import { Roles } from '../security/security.decorators.js';
import { UnitSchedulesService } from './unit-schedules.service.js';

@Controller('units/:unitId/schedule')
export class UnitSchedulesController {
  constructor(private readonly service: UnitSchedulesService) {}
  @Get() get(@Param('unitId') unitId: string) { return this.service.get(unitId); }
  @Put('weekly') @Roles('PLATFORM_SUPERADMIN', 'TENANT_ADMIN', 'UNIT_MANAGER') replaceWeekly(@Param('unitId') unitId: string, @Body() body: { enabled?: unknown; intervals?: unknown }) { return this.service.replaceWeekly(unitId, body); }
  @Put('exceptions/:date') @Roles('PLATFORM_SUPERADMIN', 'TENANT_ADMIN', 'UNIT_MANAGER') setException(@Param('unitId') unitId: string, @Param('date') date: string, @Body() body: { closed?: unknown; label?: unknown; intervals?: unknown }) { return this.service.setException(unitId, date, body); }
  @Delete('exceptions/:date') @Roles('PLATFORM_SUPERADMIN', 'TENANT_ADMIN', 'UNIT_MANAGER') removeException(@Param('unitId') unitId: string, @Param('date') date: string) { return this.service.removeException(unitId, date); }
  @Post('blocks') @Roles('PLATFORM_SUPERADMIN', 'TENANT_ADMIN', 'UNIT_MANAGER') addBlock(@Param('unitId') unitId: string, @Body() body: Record<string, unknown>) { return this.service.addBlock(unitId, body); }
  @Delete('blocks/:id') @Roles('PLATFORM_SUPERADMIN', 'TENANT_ADMIN', 'UNIT_MANAGER') removeBlock(@Param('unitId') unitId: string, @Param('id') id: string) { return this.service.removeBlock(unitId, id); }
}
