import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { createHash, timingSafeEqual } from 'node:crypto';

/** API_CLIENTS is a JSON object mapping stable consumer names to secret keys. */
@Injectable()
export class ApiKeyGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<{ headers: Record<string, string | string[] | undefined>; consumerId?: string }>();
    const supplied = request.headers['x-api-key'];
    if (typeof supplied !== 'string' || supplied.length < 32 || supplied.length > 512) throw new UnauthorizedException();
    let clients: unknown;
    try { clients = JSON.parse(process.env.API_CLIENTS ?? '{}'); } catch { throw new UnauthorizedException(); }
    if (!clients || typeof clients !== 'object' || Array.isArray(clients)) throw new UnauthorizedException();
    const digest = createHash('sha256').update(supplied).digest();
    let consumer: string | undefined;
    for (const [id, key] of Object.entries(clients)) {
      if (!/^[a-zA-Z0-9_-]{1,64}$/.test(id) || typeof key !== 'string' || key.length < 32 || key.length > 512) continue;
      if (timingSafeEqual(digest, createHash('sha256').update(key).digest())) {
        // A key shared by two consumers cannot establish a unique identity.
        if (consumer !== undefined) throw new UnauthorizedException();
        consumer = id;
      }
    }
    if (!consumer) throw new UnauthorizedException();
    request.consumerId = consumer;
    return true;
  }
}
