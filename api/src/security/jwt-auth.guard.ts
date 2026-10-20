import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { jwtVerify } from 'jose';
import { IS_PUBLIC } from './security.decorators.js';
import type { AccessClaims, AuthenticatedRequest } from './security.types.js';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly reflector: Reflector, private readonly config: ConfigService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const [scheme, token] = request.headers.authorization?.split(' ') ?? [];
    if (scheme !== 'Bearer' || !token) throw new UnauthorizedException({ code: 'ACCESS_TOKEN_REQUIRED', message: 'Entre novamente para continuar.' });

    try {
      const { payload } = await jwtVerify(token, this.secret(), { issuer: 'clinic-api', audience: 'clinic-web' });
      if (
        typeof payload.sub !== 'string' ||
        typeof payload.tenantId !== 'string' ||
        typeof payload.membershipId !== 'string' ||
        typeof payload.sessionId !== 'string'
      ) throw new Error('Invalid claims');
      request.user = payload as unknown as AccessClaims;
      return true;
    } catch {
      throw new UnauthorizedException({ code: 'ACCESS_TOKEN_INVALID', message: 'A sessão expirou. Entre novamente para continuar.' });
    }
  }

  private secret(): Uint8Array {
    const secret = this.config.get<string>('JWT_ACCESS_SECRET');
    if (!secret || secret.length < 32) throw new Error('JWT_ACCESS_SECRET deve ter pelo menos 32 caracteres.');
    return new TextEncoder().encode(secret);
  }
}
