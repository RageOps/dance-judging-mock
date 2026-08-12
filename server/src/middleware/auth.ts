import { and, eq } from 'drizzle-orm'
import type { FastifyReply, FastifyRequest } from 'fastify'
import { db } from '../db/client.js'
import { judgeEventAssignments } from '../db/schema.js'

export type AuthUser = {
  id: string
  email: string
  firstName: string
  lastName: string
  role: 'admin' | 'judge'
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: AuthUser
    user: AuthUser
  }
}

export async function requireAuth(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  try {
    await request.jwtVerify()
  } catch {
    return reply.code(401).send({ message: 'Authentication required' })
  }
}

export async function requireAdmin(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  await requireAuth(request, reply)
  if (reply.sent) return
  if (request.user.role !== 'admin') {
    return reply.code(403).send({ message: 'Administrator access required' })
  }
}

export async function hasEventAccess(request: FastifyRequest, eventId: string) {
  if (request.user.role === 'admin') return true
  const [assignment] = await db
    .select({ eventId: judgeEventAssignments.eventId })
    .from(judgeEventAssignments)
    .where(
      and(
        eq(judgeEventAssignments.judgeId, request.user.id),
        eq(judgeEventAssignments.eventId, eventId),
      ),
    )
    .limit(1)
  return Boolean(assignment)
}

export async function requireEventAccess(
  request: FastifyRequest,
  reply: FastifyReply,
  eventId: string,
) {
  if (!(await hasEventAccess(request, eventId))) {
    reply.code(403).send({ message: 'Event access denied' })
    return false
  }
  return true
}
