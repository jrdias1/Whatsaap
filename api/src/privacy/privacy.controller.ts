import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { Roles } from '../security/security.decorators.js';
import { PrivacyService } from './privacy.service.js';

@Controller('privacy/requests')
@Roles('TENANT_ADMIN')
export class PrivacyController {
  constructor(private readonly privacy: PrivacyService) {}
  @Get() list() { return this.privacy.list(); }
  @Post() create(@Body() body: { patientId?: unknown; type?: unknown; reason?: unknown }) { return this.privacy.create(body); }
  @Patch(':id') update(@Param('id') id: string, @Body() body: { status?: unknown; closureReason?: unknown; assignedToId?: unknown }) { return this.privacy.update(id, body); }
}
