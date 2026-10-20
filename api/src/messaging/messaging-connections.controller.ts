import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { Roles } from '../security/security.decorators.js';
import { MessagingConnectionsService } from './messaging-connections.service.js';

@Controller('messaging/connections')
export class MessagingConnectionsController {
  constructor(private readonly service: MessagingConnectionsService) {}

  @Get()
  @Roles('TENANT_ADMIN')
  list(@Query('unitId') unitId?: string) { return this.service.list(unitId); }

  @Post('meta')
  @Roles('TENANT_ADMIN')
  createMeta(@Body() body: Record<string, unknown>) { return this.service.createMeta(body); }

  @Post('evolution/connect')
  @Roles('TENANT_ADMIN', 'OPERATOR')
  connectEvolution(@Body() body: Record<string, unknown>) { return this.service.connectEvolution(body.unitId); }

  @Get('operational-status')
  @Roles('TENANT_ADMIN', 'OPERATOR')
  operationalStatus(@Query('unitId') unitId: string) { return this.service.operatorConnectionStatus(unitId); }

  @Get(':id/status')
  @Roles('TENANT_ADMIN')
  evolutionStatus(@Param('id') id: string) { return this.service.evolutionStatus(id); }

  @Post(':id/disconnect')
  @Roles('TENANT_ADMIN')
  disconnectEvolution(@Param('id') id: string) { return this.service.disconnectEvolution(id); }

  @Post(':id/dry-run')
  @Roles('TENANT_ADMIN')
  dryRun(@Param('id') id: string) { return this.service.dryRun(id); }

  @Post(':id/disconnect-local')
  @Roles('TENANT_ADMIN')
  disconnectLocally(@Param('id') id: string) { return this.service.disconnectLocally(id); }
}
