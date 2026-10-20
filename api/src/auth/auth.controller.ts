import { Body, Controller, Get, Patch, Post, Req, Res, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { AuthService } from './auth.service.js';
import { AllowPendingPasswordChange, Public } from '../security/security.decorators.js';
import type { AuthenticatedRequest } from '../security/security.types.js';
import { PrismaService } from '../prisma/prisma.service.js';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService, private readonly config: ConfigService, private readonly prisma: PrismaService) {}

  @Public()
  @Post('login')
  @Throttle({ default: { limit: 8, ttl: 60_000 } })
  async login(@Body() body: Record<string, unknown>, @Res({ passthrough: true }) response: Response) {
    const result = await this.auth.login(body.email, body.password, body.tenantSlug, body.otp);
    this.setRefreshCookie(response, result.refreshToken);
    return { accessToken: result.accessToken, expiresIn: 900 };
  }

  @Public()
  @Post('refresh')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async refresh(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
    const token = this.refreshCookie(request);
    const result = await this.auth.refresh(token);
    this.setRefreshCookie(response, result.refreshToken);
    return { accessToken: result.accessToken, expiresIn: 900 };
  }

  @Public()
  @Post('logout')
  async logout(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
    await this.auth.logout(this.refreshCookie(request));
    response.clearCookie('clinic_refresh', { httpOnly: true, secure: this.isProduction(), sameSite: 'strict', path: '/api/auth' });
    return { success: true };
  }

  @Public()
  @Post('accept-invitation')
  async acceptInvitation(@Body() body: Record<string, unknown>) {
    return this.auth.acceptInvitation(body.token, body.password);
  }

  @Public()
  @Post('password-recovery/complete')
  @Throttle({ default: { limit: 3, ttl: 900_000 } })
  completePasswordRecovery(@Body() body: Record<string, unknown>) {
    return this.auth.completePasswordRecovery(body.tenantSlug, body.email, body.token, body.password);
  }

  @Get('me')
  @AllowPendingPasswordChange()
  async me(@Req() request: AuthenticatedRequest) {
    const user = await this.prisma.scoped.user.findFirst({ where: { id: request.user.sub }, select: { id: true, email: true, displayName: true, mustChangePassword: true, memberships: { where: { id: request.user.membershipId }, select: { id: true, tenantId: true, role: true, unitScopes: { select: { unitId: true } } } } } });
    if (!user) throw new UnauthorizedException();
    return user;
  }

  @Patch('password')
  @AllowPendingPasswordChange()
  @Throttle({ default: { limit: 5, ttl: 900_000 } })
  changePassword(@Req() request: AuthenticatedRequest, @Body() body: Record<string, unknown>) {
    return this.auth.changeOwnPassword(request.user.sub, request.user.tenantId, request.user.sessionId, body.currentPassword, body.newPassword);
  }

  private setRefreshCookie(response: Response, token: string) {
    response.cookie('clinic_refresh', token, { httpOnly: true, secure: this.isProduction(), sameSite: 'strict', path: '/api/auth', maxAge: 30 * 24 * 60 * 60 * 1000 });
  }

  private isProduction() { return this.config.get('NODE_ENV') === 'production'; }

  private refreshCookie(request: Request): string | undefined {
    const cookie = request.headers.cookie?.split(';').map((part) => part.trim()).find((part) => part.startsWith('clinic_refresh='));
    if (!cookie) return undefined;
    try { return decodeURIComponent(cookie.slice('clinic_refresh='.length)); } catch { return undefined; }
  }
}
