import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { Roles } from '../security/security.decorators.js';
import { AutomationsService } from './automations.service.js';

@Controller('automations')
@Roles('TENANT_ADMIN')
export class AutomationsController {
  constructor(private readonly service: AutomationsService) {}
  @Get() list() { return this.service.listRules(); }
  @Post() create(@Body() body: Record<string, unknown>) { return this.service.createRule(body); }
  @Patch(':id') update(@Param('id') id: string, @Body() body: Record<string, unknown>) { return this.service.updateRule(id, body); }
  @Patch(':id/status') status(@Param('id') id: string, @Body('status') status: string) { return this.service.setRuleStatus(id, status); }
  @Get(':id/executions') executions(@Param('id') id: string) { return this.service.listExecutions(id); }
  @Get(':id/satisfaction-results') satisfactionResults(@Param('id') id: string) { return this.service.satisfactionResults(id); }
}
