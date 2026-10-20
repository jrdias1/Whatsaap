import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { UsersService } from './users.service.js';
import { Roles } from '../security/security.decorators.js';

@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Post('members')
  @Roles('TENANT_ADMIN')
  @Throttle({ default: { limit: 5, ttl: 900_000 } })
  createManagedMember(@Body() body: { email?: unknown; displayName?: unknown; role?: unknown; password?: unknown; unitIds?: unknown }) {
    return this.users.createManagedMember(body);
  }

  @Get()
  @Roles('TENANT_ADMIN', 'UNIT_MANAGER')
  list(@Query() query: { q?: unknown; role?: unknown; unitId?: unknown; status?: unknown }) { return this.users.list(query); }

  @Get(':membershipId/history')
  @Roles('TENANT_ADMIN', 'UNIT_MANAGER')
  history(@Param('membershipId') membershipId: string) { return this.users.history(membershipId); }

  @Patch(':membershipId')
  @Roles('TENANT_ADMIN', 'UNIT_MANAGER')
  update(@Param('membershipId') membershipId: string, @Body() body: { role?: unknown; unitIds?: unknown; status?: unknown }) { return this.users.updateMembership(membershipId, body); }

  @Post(':membershipId/revoke-sessions')
  @Roles('TENANT_ADMIN', 'UNIT_MANAGER')
  revokeSessions(@Param('membershipId') membershipId: string) { return this.users.revokeSessions(membershipId); }

  @Patch(':membershipId/password')
  @Roles('TENANT_ADMIN')
  @Throttle({ default: { limit: 5, ttl: 900_000 } })
  resetMemberPassword(@Param('membershipId') membershipId: string, @Body() body: { password?: unknown }) { return this.users.resetMemberPassword(membershipId, body); }

  @Post(':membershipId/recovery')
  @Roles('TENANT_ADMIN')
  @Throttle({ default: { limit: 3, ttl: 900_000 } })
  recovery(@Param('membershipId') membershipId: string, @Body() body: { currentPassword?: unknown; identityVerification?: unknown; reason?: unknown }) { return this.users.issueRecovery(membershipId, body); }
}
