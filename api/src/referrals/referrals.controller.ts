import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Public, Roles } from '../security/security.decorators.js';
import { ReferralsService } from './referrals.service.js';

@Controller('referrals')
export class ReferralsController {
  constructor(private readonly service: ReferralsService) {}

  @Public()
  @Throttle({ default: { limit: 12, ttl: 60_000 } })
  @Post('public/:shareToken/click') click(@Param('shareToken') token: string, @Body('clickKey') key: unknown) { return this.service.registerClick(token, key); }

  @Public()
  @Throttle({ default: { limit: 6, ttl: 60_000 } })
  @Post('public/lead/:claimToken') lead(@Param('claimToken') token: string, @Body('phone') phone: unknown) { return this.service.registerLead(token, phone); }

  @Get('campaigns') @Roles('TENANT_ADMIN') campaigns() { return this.service.listCampaigns(); }
  @Post('campaigns') @Roles('TENANT_ADMIN') createCampaign(@Body() body: Record<string, unknown>) { return this.service.createCampaign(body); }
  @Patch('campaigns/:id') @Roles('TENANT_ADMIN') updateCampaign(@Param('id') id: string, @Body() body: Record<string, unknown>) { return this.service.updateCampaign(id, body); }
  @Patch('campaigns/:id/status') @Roles('TENANT_ADMIN') campaignStatus(@Param('id') id: string, @Body('status') status: string) { return this.service.setCampaignStatus(id, status); }
  @Post('campaigns/:id/participants') @Roles('TENANT_ADMIN') participant(@Param('id') id: string, @Body() body: Record<string, unknown>) { return this.service.issueParticipantLink(id, String(body.patientId ?? ''), String(body.unitId ?? '')); }
  @Get('board') @Roles('TENANT_ADMIN') board() { return this.service.board(); }
  @Get() @Roles('TENANT_ADMIN') referrals(@Query('campaignId') campaignId?: string) { return this.service.listReferrals(campaignId); }
  @Patch(':id/status') @Roles('TENANT_ADMIN') referralStatus(@Param('id') id: string, @Body() body: Record<string, unknown>) { return this.service.changeReferralStatus(id, String(body.status ?? ''), body.reason); }
  @Patch(':id/patient') @Roles('TENANT_ADMIN') associate(@Param('id') id: string, @Body('patientId') patientId: string) { return this.service.associatePatient(id, patientId); }
  @Get('rewards') @Roles('TENANT_ADMIN') rewards(@Query('status') status?: string) { return this.service.rewards(status); }
  @Patch('rewards/:id/decision') @Roles('TENANT_ADMIN') decision(@Param('id') id: string, @Body() body: Record<string, unknown>) { return this.service.decideReward(id, body.action === 'APPROVE' ? 'APPROVE' : 'REJECT', body.reason); }
  @Post('rewards/:id/issue') @Roles('TENANT_ADMIN') issue(@Param('id') id: string) { return this.service.issueReward(id); }
  @Post('rewards/redeem') @Roles('TENANT_ADMIN', 'UNIT_MANAGER', 'OPERATOR') redeem(@Body() body: Record<string, unknown>) { return this.service.redeemVoucher(body); }
  @Get('loyalty/:patientId') @Roles('TENANT_ADMIN', 'UNIT_MANAGER', 'OPERATOR') loyalty(@Param('patientId') id: string) { return this.service.loyaltyCard(id); }
}
