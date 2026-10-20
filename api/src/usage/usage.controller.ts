import { Controller, Get } from '@nestjs/common';
import { Roles } from '../security/security.decorators.js';
import { UsageService } from './usage.service.js';

@Controller('usage')
export class UsageController {
  constructor(private readonly service: UsageService) {}
  @Get() @Roles('TENANT_ADMIN', 'PLATFORM_SUPERADMIN')
  summary() { return this.service.summary(); }
}
