import { CanActivate, ExecutionContext, Injectable, SetMetadata, UnauthorizedException, ForbiddenException } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import type { FastifyRequest } from 'fastify'
import { NaijaDealIdentityClient, type NaijaDealUser } from '../infra/identity-client.js'

export const RIDE_PERMISSION_KEY = 'naijadrive:permission'
export const RequireRidePermission = (permission: string) => SetMetadata(RIDE_PERMISSION_KEY, permission)

function sessionToken(request: FastifyRequest): string | null {
  const authorization = request.headers.authorization
  if (authorization?.startsWith('Bearer ')) return authorization.slice(7).trim() || null
  const cookie = request.headers.cookie?.split(';').map((part) => part.trim()).find((part) => part.startsWith('nd_session='))
  return cookie ? decodeURIComponent(cookie.slice('nd_session='.length)) : null
}

@Injectable()
export class NaijaDealAuthGuard implements CanActivate {
  constructor(private readonly identity: NaijaDealIdentityClient) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<FastifyRequest & { user?: NaijaDealUser }>()
    const token = sessionToken(request)
    if (!token) throw new UnauthorizedException('Authentication required')
    const user = await this.identity.introspect(token)
    if (!user || user.status !== 'active') throw new UnauthorizedException('Authentication required')
    request.user = user
    return true
  }
}

@Injectable()
export class RidePermissionGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const permission = this.reflector.get<string>(RIDE_PERMISSION_KEY, context.getHandler())
    if (!permission) return true
    const request = context.switchToHttp().getRequest<FastifyRequest & { user?: NaijaDealUser }>()
    const user = request.user
    if (!user || (!user.permissions.includes(permission) && !['admin', 'ride_operations_manager'].includes(user.role))) {
      throw new ForbiddenException('Missing required permission')
    }
    return true
  }
}
