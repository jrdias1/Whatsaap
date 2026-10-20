import { Body, Controller, Get, Param, Patch } from '@nestjs/common';
import { Roles } from '../security/security.decorators.js';
import { TenantSettingsService } from './tenant-settings.service.js';

@Controller('settings')
export class TenantSettingsController {
  constructor(private readonly settings: TenantSettingsService) {}
  @Get('tenant') get() { return this.settings.get(); }
  @Patch('tenant') @Roles('TENANT_ADMIN') update(@Body() body: Record<string, unknown>) { return this.settings.updateTenant(body); }
  @Patch('units/:id') @Roles('TENANT_ADMIN') updateUnit(@Param('id') id: string, @Body() body: Record<string, unknown>) { return this.settings.updateUnit(id, body); }
  @Get('setup') @Roles('TENANT_ADMIN') progress() { return this.settings.setupProgress(); }
}
