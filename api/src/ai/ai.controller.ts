import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { Roles } from '../security/security.decorators.js';
import { AiService } from './ai.service.js';

@Controller('ai')
export class AiController {
  constructor(private readonly service: AiService) {}

  @Get('settings') @Roles('TENANT_ADMIN')
  settings() { return this.service.settings(); }

  @Patch('settings') @Roles('TENANT_ADMIN')
  configure(@Body() body: Record<string, unknown>) { return this.service.configure(body); }

  @Get('conversations/:id/drafts')
  drafts(@Param('id') id: string) { return this.service.listDrafts(id); }

  @Post('conversations/:id/drafts') @Roles('TENANT_ADMIN', 'UNIT_MANAGER', 'OPERATOR')
  createDraft(@Param('id') id: string) { return this.service.createDraft(id); }

  @Post('drafts/:id/approve') @Roles('TENANT_ADMIN', 'UNIT_MANAGER', 'OPERATOR')
  approve(@Param('id') id: string, @Body() body: Record<string, unknown>) {
    return this.service.reviewDraft(id, true, body.purpose);
  }

  @Post('drafts/:id/reject') @Roles('TENANT_ADMIN', 'UNIT_MANAGER', 'OPERATOR')
  reject(@Param('id') id: string) { return this.service.reviewDraft(id, false); }
}
