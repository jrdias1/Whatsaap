import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { Roles } from '../security/security.decorators.js';
import { AppointmentsService } from './appointments.service.js';

@Controller('appointments')
export class AppointmentsController {
  constructor(private readonly service: AppointmentsService) {}
  @Get() list(
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('unitId') unitId?: string,
    @Query('status') status?: string,
    @Query('search') search?: string,
    @Query('resourceId') resourceId?: string,
  ) {
    return this.service.list(from, to, { unitId, status, search, resourceId });
  }
  @Get('availability') availability(@Query() query: { unitId?: string; procedureId?: string; startsAt?: string; durationMinutes?: string; resourceIds?: string; excludeAppointmentId?: string; allowOutsideHours?: string }) {
    return this.service.availability({ ...query, allowOutsideHours: query.allowOutsideHours === 'true', resourceIds: query.resourceIds?.split(',').filter(Boolean) });
  }
  @Get(':id') get(@Param('id') id: string) {
    return this.service.get(id);
  }
  @Post() @Roles('TENANT_ADMIN', 'UNIT_MANAGER', 'OPERATOR') create(
    @Body() body: Record<string, unknown>,
  ) {
    return this.service.create(body);
  }
  @Patch(':id/status')
  @Roles('TENANT_ADMIN', 'UNIT_MANAGER', 'OPERATOR')
  status(@Param('id') id: string, @Body('status') status: string) {
    return this.service.changeStatus(id, status);
  }
  @Patch(':id/reschedule')
  @Roles('TENANT_ADMIN', 'UNIT_MANAGER', 'OPERATOR')
  reschedule(@Param('id') id: string, @Body() body: Record<string, unknown>) {
    return this.service.reschedule(id, body);
  }
}
