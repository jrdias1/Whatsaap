import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { Roles } from '../security/security.decorators.js';
import { TasksService } from './tasks.service.js';

@Controller('tasks')
export class TasksController {
  constructor(private readonly tasks: TasksService) {}

  @Get() list(@Query() query: { unitId?: string; assigneeId?: string; status?: string; appointmentId?: string }) { return this.tasks.list(query); }
  @Post() @Roles('TENANT_ADMIN', 'UNIT_MANAGER', 'OPERATOR') create(@Body() body: Record<string, unknown>) { return this.tasks.create(body); }
  @Patch(':id') @Roles('TENANT_ADMIN', 'UNIT_MANAGER', 'OPERATOR') update(@Param('id') id: string, @Body() body: Record<string, unknown>) { return this.tasks.update(id, body); }
  @Patch(':id/status') @Roles('TENANT_ADMIN', 'UNIT_MANAGER', 'OPERATOR') status(@Param('id') id: string, @Body() body: Record<string, unknown>) { return this.tasks.changeStatus(id, body.status); }
  @Get(':id/history') history(@Param('id') id: string) { return this.tasks.history(id); }
}
