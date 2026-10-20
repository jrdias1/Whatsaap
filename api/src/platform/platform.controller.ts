import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Roles } from '../security/security.decorators.js';
import { PlatformService } from './platform.service.js';

@Controller('platform')
@Roles('PLATFORM_SUPERADMIN')
export class PlatformController {
  constructor(private readonly platform: PlatformService) {}
  @Get('dashboard') dashboard() { return this.platform.dashboard(); }
  @Get('plans') plans() { return this.platform.plans(); }
  @Get('tenants/:id') tenant(@Param('id') id: string) { return this.platform.tenantDetails(id); }
  @Post('tenants') @Throttle({ default: { limit: 5, ttl: 60_000 } }) provision(@Body() body: Record<string, unknown>) { return this.platform.provision(body); }
  @Post('tenants/:id/memberships') @Throttle({ default: { limit: 5, ttl: 900_000 } }) inviteMember(@Param('id') id: string, @Body() body: Record<string, unknown>) { return this.platform.inviteTenantMember(id, body); }
  @Post('tenants/:id/members') @Throttle({ default: { limit: 5, ttl: 900_000 } }) createMember(@Param('id') id: string, @Body() body: Record<string, unknown>) { return this.platform.createTenantMember(id, body); }
  @Patch('tenants/:id/memberships/:membershipId') @Throttle({ default: { limit: 10, ttl: 900_000 } }) updateMember(@Param('id') id: string, @Param('membershipId') membershipId: string, @Body() body: Record<string, unknown>) { return this.platform.updateTenantMember(id, membershipId, body); }
  @Patch('tenants/:id/memberships/:membershipId/password') @Throttle({ default: { limit: 5, ttl: 900_000 } }) resetMemberPassword(@Param('id') id: string, @Param('membershipId') membershipId: string, @Body() body: Record<string, unknown>) { return this.platform.resetTenantMemberPassword(id, membershipId, body); }
  @Post('tenants/:id/memberships/:membershipId/recovery') @Throttle({ default: { limit: 3, ttl: 900_000 } }) recoverMember(@Param('id') id: string, @Param('membershipId') membershipId: string, @Body() body: Record<string, unknown>) { return this.platform.recoverTenantMember(id, membershipId, body); }
  @Post('tenants/:id/memberships/:membershipId/revoke-sessions') @Throttle({ default: { limit: 10, ttl: 900_000 } }) revokeMemberSessions(@Param('id') id: string, @Param('membershipId') membershipId: string, @Body() body: Record<string, unknown>) { return this.platform.revokeTenantMemberSessions(id, membershipId, body); }
  @Patch('tenants/:id') @Throttle({ default: { limit: 5, ttl: 60_000 } }) update(@Param('id') id: string, @Body() body: Record<string, unknown>) { return this.platform.updateTenant(id, body); }
  @Patch('tenants/:id/status') @Throttle({ default: { limit: 5, ttl: 60_000 } }) status(@Param('id') id: string, @Body() body: Record<string, unknown>) { return this.platform.status(id, body); }
  @Patch('tenants/:id/limits') @Throttle({ default: { limit: 5, ttl: 60_000 } }) limits(@Param('id') id: string, @Body() body: Record<string, unknown>) { return this.platform.limits(id, body); }
  @Patch('tenants/:id/plan') @Throttle({ default: { limit: 5, ttl: 60_000 } }) plan(@Param('id') id: string, @Body() body: Record<string, unknown>) { return this.platform.changePlan(id, body); }
}
