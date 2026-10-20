import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { Roles } from '../security/security.decorators.js';
import { QuickRepliesService } from './quick-replies.service.js';

@Controller('quick-replies')
export class QuickRepliesController {
  constructor(private readonly service: QuickRepliesService) {}
  @Get() list(@Query('search') search?: string) { return this.service.list(search); }
  @Post() @Roles('TENANT_ADMIN', 'UNIT_MANAGER') create(@Body() body: Record<string, unknown>) { return this.service.create(body); }
  @Patch(':id') @Roles('TENANT_ADMIN', 'UNIT_MANAGER') update(@Param('id') id: string, @Body() body: Record<string, unknown>) { return this.service.update(id, body); }
  @Post(':id/preview') preview(@Param('id') id: string, @Body() body: Record<string, unknown>) { return this.service.preview(id, String(body.conversationId ?? '')); }
}
