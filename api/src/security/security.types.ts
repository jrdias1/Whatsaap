import type { UserRole } from '@prisma/client';
import type { Request } from 'express';

export interface AccessClaims {
  sub: string;
  tenantId: string;
  membershipId: string;
  sessionId: string;
  role: UserRole;
}

export interface AuthenticatedRequest extends Request {
  user: AccessClaims;
}
