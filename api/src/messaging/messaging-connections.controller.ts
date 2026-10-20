import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { Roles } from '../security/security.decorators.js';
import { MessagingConnectionsService } from './messaging-connections.service.js';

@Controller('messaging/connections')
@Roles('TENANT_ADMIN')
export class MessagingConnectionsController {
  constructor(private readonly service: MessagingConnectionsService) {}
  @Get() list(@Query('unitId') unitId?: string) { return this.service.list(unitId); }
  @Post('meta') createMeta(@Body() body: Record<string, unknown>) { return this.service.createMeta(body); }
  @Post('evolution/connect') connectEvolution(@Body() body: Record<string, unknown>) { return this.service.connectEvolution(body.unitId); }
  @Get(':id/status') evolutionStatus(@Param('id') id: string) { return this.service.evolutionStatus(id); }
  @Post(':id/disconnect') disconnectEvolution(@Param('id') id: string) { return this.service.disconnectEvolution(id); }
  @Post(':id/dry-run') dryRun(@Param('id') id: string) { return this.service.dryRun(id); }
  @Post(':id/disconnect-local') disconnectLocally(@Param('id') id: string) { return this.service.disconnectLocally(id); }
}
