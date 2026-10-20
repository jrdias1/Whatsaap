import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { Roles } from '../security/security.decorators.js';
import { CampaignsService } from './campaigns.service.js';

@Controller('campaigns')
export class CampaignsController {
  constructor(private readonly service: CampaignsService) {}
  @Get() @Roles('TENANT_ADMIN', 'UNIT_MANAGER', 'OPERATOR') list() {
    return this.service.list();
  }
  @Get('audience') @Roles('TENANT_ADMIN', 'OPERATOR') audience(@Query('search') search = '', @Query('ids') ids = '') {
    return this.service.audience(search, ids);
  }
  @Post() @Roles('TENANT_ADMIN', 'OPERATOR') create(
    @Body() body: Record<string, unknown>,
  ) {
    return this.service.create(body);
  }
  @Patch(':id') @Roles('TENANT_ADMIN', 'OPERATOR') update(@Param('id') id: string, @Body() body: Record<string, unknown>) {
    return this.service.update(id, body);
  }
  @Post(':id/approve') @Roles('TENANT_ADMIN', 'OPERATOR') approve(
    @Param('id') id: string,
  ) {
    return this.service.approve(id);
  }
  @Get('automations') @Roles('TENANT_ADMIN') automations() {
    return this.service.listAutomations();
  }
  @Post('automations') @Roles('TENANT_ADMIN') automation(
    @Body() body: Record<string, unknown>,
  ) {
    return this.service.createAutomation(body);
  }
}
