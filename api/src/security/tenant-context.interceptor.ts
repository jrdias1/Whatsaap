import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
import { TenantContext } from './tenant-context.js';
import type { AuthenticatedRequest } from './security.types.js';

@Injectable()
export class TenantContextInterceptor implements NestInterceptor {
  constructor(private readonly tenantContext: TenantContext) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!request.user?.tenantId) return next.handle();
    return new Observable((subscriber) => this.tenantContext.run({
      tenantId: request.user.tenantId,
      userId: request.user.sub,
      membershipId: request.user.membershipId,
      role: request.user.role,
    }, () => next.handle().subscribe(subscriber)));
  }
}
