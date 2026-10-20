import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { Roles } from '../security/security.decorators.js';
import { InboxService } from './inbox.service.js';

@Controller('inbox')
export class InboxController {
  constructor(private readonly service: InboxService) {}
  @Get('conversations') list(@Query('unitId') unitId?: string, @Query('assigneeId') assigneeId?: string) {
    return this.service.list(unitId, assigneeId);
  }
  @Get('stages') stages() { return this.service.stages(); }
  @Post('stages') @Roles('TENANT_ADMIN') createStage(@Body() body: Record<string, unknown>) { return this.service.createStage(body); }
  @Patch('stages/:id') @Roles('TENANT_ADMIN') updateStage(@Param('id') id: string, @Body() body: Record<string, unknown>) { return this.service.updateStage(id, body); }
  @Get('assignees') assignees(@Query('unitId') unitId?: string) { return this.service.assignees(unitId); }
  @Post('conversations')
  @Roles('TENANT_ADMIN', 'UNIT_MANAGER', 'OPERATOR')
  open(@Body() body: Record<string, unknown>) {
    return this.service.open(body);
  }
  @Get('conversations/:id/messages') messages(@Param('id') id: string) {
    return this.service.messages(id);
  }
  @Post('conversations/:id/messages')
  @Roles('TENANT_ADMIN', 'UNIT_MANAGER', 'OPERATOR')
  message(@Param('id') id: string, @Body() body: Record<string, unknown>) {
    return this.service.addMessage(id, body);
  }
  @Post('conversations/:id/close')
  @Roles('TENANT_ADMIN', 'UNIT_MANAGER', 'OPERATOR')
  close(@Param('id') id: string) {
    return this.service.close(id);
  }
  @Post('conversations/:id/claim')
  @Roles('TENANT_ADMIN', 'UNIT_MANAGER', 'OPERATOR')
  claim(@Param('id') id: string) { return this.service.claim(id); }
  @Patch('conversations/:id/assignment')
  @Roles('TENANT_ADMIN', 'UNIT_MANAGER', 'OPERATOR')
  assign(@Param('id') id: string, @Body() body: Record<string, unknown>) { return this.service.changeAssignment(id, body.assigneeId); }
  @Get('conversations/:id/assignment-history')
  assignmentHistory(@Param('id') id: string) { return this.service.assignmentHistory(id); }
  @Patch('conversations/:id/status')
  @Roles('TENANT_ADMIN', 'UNIT_MANAGER', 'OPERATOR')
  status(@Param('id') id: string, @Body() body: Record<string, unknown>) {
    return this.service.changeStatus(id, body.status);
  }
  @Patch('conversations/:id/stage')
  @Roles('TENANT_ADMIN', 'UNIT_MANAGER', 'OPERATOR')
  stage(@Param('id') id: string, @Body() body: Record<string, unknown>) { return this.service.moveStage(id, body.stageId, body.enrollCampaign); }
  @Get('conversations/:id/stage-history')
  stageHistory(@Param('id') id: string) { return this.service.stageHistory(id); }
}
