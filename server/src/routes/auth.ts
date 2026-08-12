import bcrypt from 'bcryptjs'
import { eq } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { db } from '../db/client.js'
import { users } from '../db/schema.js'
import { requireAuth, type AuthUser } from '../middleware/auth.js'

const cookieName = 'judging_session'
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null
const nonEmptyString = (value: unknown) =>
  typeof value === 'string' && value.trim() ? value.trim() : null

export async function authRoutes(app: FastifyInstance) {
  app.post('/api/auth/login', async (request, reply) => {
    const body = isRecord(request.body) ? request.body : {}
    const email = nonEmptyString(body.email)?.toLowerCase()
    const password = nonEmptyString(body.password)
    if (!email || !password) {
      return reply.code(400).send({ message: 'Email and password are required' })
    }

    const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1)
    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
      return reply.code(401).send({ message: 'Invalid email or password' })
    }

    const session: AuthUser = {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      role: user.role,
    }
    const token = app.jwt.sign(session, { expiresIn: '12h' })
    reply.setCookie(cookieName, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.COOKIE_SECURE === 'true',
      path: '/',
      maxAge: 60 * 60 * 12,
    })
    return session
  })

  app.post(
    '/api/auth/logout',
    { preHandler: requireAuth },
    async (_request, reply) => {
      reply.clearCookie(cookieName, { path: '/' })
      return reply.code(204).send()
    },
  )

  app.get(
    '/api/auth/me',
    { preHandler: requireAuth },
    async (request) => request.user,
  )
}
