import bcrypt from 'bcryptjs'
import { and, asc, count, eq, inArray } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { db } from '../db/client.js'
import {
  events,
  judgeEventAssignments,
  scoreSubmissions,
  users,
} from '../db/schema.js'
import { requireAdmin } from '../middleware/auth.js'

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null
const nonEmptyString = (value: unknown) =>
  typeof value === 'string' && value.trim() ? value.trim() : null
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

async function listJudges() {
  const judgeRows = await db
    .select({
      id: users.id,
      email: users.email,
      firstName: users.firstName,
      lastName: users.lastName,
      createdAt: users.createdAt,
    })
    .from(users)
    .where(eq(users.role, 'judge'))
    .orderBy(asc(users.lastName), asc(users.firstName))

  const assignments = await db
    .select({
      judgeId: judgeEventAssignments.judgeId,
      eventId: events.id,
      eventName: events.name,
    })
    .from(judgeEventAssignments)
    .innerJoin(events, eq(events.id, judgeEventAssignments.eventId))

  return judgeRows.map((judge) => ({
    ...judge,
    events: assignments
      .filter((assignment) => assignment.judgeId === judge.id)
      .map(({ eventId, eventName }) => ({ id: eventId, name: eventName })),
  }))
}

export async function judgeRoutes(app: FastifyInstance) {
  app.get('/api/judges', { preHandler: requireAdmin }, listJudges)

  app.post('/api/judges', { preHandler: requireAdmin }, async (request, reply) => {
    const body = isRecord(request.body) ? request.body : {}
    const firstName = nonEmptyString(body.firstName)
    const lastName = nonEmptyString(body.lastName)
    const email = nonEmptyString(body.email)?.toLowerCase()
    const password = nonEmptyString(body.password)
    const eventIds = Array.isArray(body.eventIds)
      ? [...new Set(body.eventIds.filter((id): id is string => typeof id === 'string'))]
      : []

    if (!firstName || !lastName || !email || !password || password.length < 8) {
      return reply.code(400).send({
        message: 'First name, last name, email, and an 8+ character password are required',
      })
    }
    if (eventIds.some((id) => !uuidPattern.test(id))) {
      return reply.code(400).send({ message: 'Invalid event assignment' })
    }

    try {
      const judge = await db.transaction(async (tx) => {
        if (eventIds.length) {
          const matchingEvents = await tx
            .select({ id: events.id })
            .from(events)
            .where(inArray(events.id, eventIds))
          if (matchingEvents.length !== eventIds.length) {
            throw new Error('EVENT_NOT_FOUND')
          }
        }

        const [created] = await tx
          .insert(users)
          .values({
            firstName,
            lastName,
            email,
            passwordHash: await bcrypt.hash(password, 12),
            role: 'judge',
          })
          .returning({
            id: users.id,
            email: users.email,
            firstName: users.firstName,
            lastName: users.lastName,
            createdAt: users.createdAt,
          })
        if (!created) throw new Error('CREATE_FAILED')

        if (eventIds.length) {
          await tx.insert(judgeEventAssignments).values(
            eventIds.map((eventId) => ({ judgeId: created.id, eventId })),
          )
        }
        return created
      })
      return reply.code(201).send({
        ...judge,
        events: eventIds.map((id) => ({ id })),
      })
    } catch (error) {
      if (error instanceof Error && error.message === 'EVENT_NOT_FOUND') {
        return reply.code(400).send({ message: 'One or more events do not exist' })
      }
      if (
        isRecord(error) &&
        error.code === '23505'
      ) {
        return reply.code(409).send({ message: 'A user with this email already exists' })
      }
      throw error
    }
  })

  app.patch<{ Params: { judgeId: string } }>(
    '/api/judges/:judgeId',
    { preHandler: requireAdmin },
    async (request, reply) => {
      const body = isRecord(request.body) ? request.body : {}
      const firstName = nonEmptyString(body.firstName)
      const lastName = nonEmptyString(body.lastName)
      const email = nonEmptyString(body.email)?.toLowerCase()
      const password =
        body.password === undefined || body.password === ''
          ? null
          : nonEmptyString(body.password)
      if (!firstName || !lastName || !email || (password && password.length < 8)) {
        return reply.code(400).send({ message: 'Invalid judge profile' })
      }

      try {
        const [updated] = await db
          .update(users)
          .set({
            firstName,
            lastName,
            email,
            ...(password ? { passwordHash: await bcrypt.hash(password, 12) } : {}),
          })
          .where(
            and(eq(users.id, request.params.judgeId), eq(users.role, 'judge')),
          )
          .returning({
            id: users.id,
            email: users.email,
            firstName: users.firstName,
            lastName: users.lastName,
          })
        return updated ?? reply.code(404).send({ message: 'Judge not found' })
      } catch (error) {
        if (isRecord(error) && error.code === '23505') {
          return reply.code(409).send({ message: 'A user with this email already exists' })
        }
        throw error
      }
    },
  )

  app.put<{ Params: { judgeId: string } }>(
    '/api/judges/:judgeId/events',
    { preHandler: requireAdmin },
    async (request, reply) => {
      const body = isRecord(request.body) ? request.body : {}
      const eventIds = Array.isArray(body.eventIds)
        ? [...new Set(body.eventIds.filter((id): id is string => typeof id === 'string'))]
        : null
      if (!eventIds || eventIds.some((id) => !uuidPattern.test(id))) {
        return reply.code(400).send({ message: 'Valid eventIds are required' })
      }

      const result = await db.transaction(async (tx) => {
        const [judge] = await tx
          .select({ id: users.id })
          .from(users)
          .where(
            and(eq(users.id, request.params.judgeId), eq(users.role, 'judge')),
          )
          .limit(1)
        if (!judge) return 'JUDGE_NOT_FOUND'

        if (eventIds.length) {
          const matchingEvents = await tx
            .select({ id: events.id })
            .from(events)
            .where(inArray(events.id, eventIds))
          if (matchingEvents.length !== eventIds.length) return 'EVENT_NOT_FOUND'
        }

        await tx
          .delete(judgeEventAssignments)
          .where(eq(judgeEventAssignments.judgeId, judge.id))
        if (eventIds.length) {
          await tx.insert(judgeEventAssignments).values(
            eventIds.map((eventId) => ({ judgeId: judge.id, eventId })),
          )
        }
        return 'OK'
      })

      if (result === 'JUDGE_NOT_FOUND') {
        return reply.code(404).send({ message: 'Judge not found' })
      }
      if (result === 'EVENT_NOT_FOUND') {
        return reply.code(400).send({ message: 'One or more events do not exist' })
      }
      return reply.code(204).send()
    },
  )

  app.delete<{ Params: { judgeId: string } }>(
    '/api/judges/:judgeId',
    { preHandler: requireAdmin },
    async (request, reply) => {
      const [submissionCount] = await db
        .select({ value: count() })
        .from(scoreSubmissions)
        .where(eq(scoreSubmissions.judgeId, request.params.judgeId))
      if (Number(submissionCount?.value ?? 0) > 0) {
        return reply
          .code(409)
          .send({ message: 'Judges with saved scores cannot be deleted' })
      }
      const [deleted] = await db
        .delete(users)
        .where(
          and(eq(users.id, request.params.judgeId), eq(users.role, 'judge')),
        )
        .returning({ id: users.id })
      if (!deleted) return reply.code(404).send({ message: 'Judge not found' })
      return reply.code(204).send()
    },
  )
}
