import bcrypt from 'bcryptjs'
import { and, asc, eq, inArray } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { db } from '../db/client.js'
import {
  coordinatorEventAssignments,
  events,
  users,
} from '../db/schema.js'
import { requireAdmin } from '../middleware/auth.js'

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null
const nonEmptyString = (value: unknown) =>
  typeof value === 'string' && value.trim() ? value.trim() : null
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

async function listCoordinators() {
  const coordinatorRows = await db
    .select({
      id: users.id,
      email: users.email,
      firstName: users.firstName,
      lastName: users.lastName,
      createdAt: users.createdAt,
    })
    .from(users)
    .where(eq(users.role, 'coordinator'))
    .orderBy(asc(users.lastName), asc(users.firstName))

  const assignments = await db
    .select({
      coordinatorId: coordinatorEventAssignments.coordinatorId,
      eventId: events.id,
      eventName: events.name,
    })
    .from(coordinatorEventAssignments)
    .innerJoin(events, eq(events.id, coordinatorEventAssignments.eventId))

  return coordinatorRows.map((coordinator) => ({
    ...coordinator,
    events: assignments
      .filter((assignment) => assignment.coordinatorId === coordinator.id)
      .map(({ eventId, eventName }) => ({ id: eventId, name: eventName })),
  }))
}

export async function coordinatorRoutes(app: FastifyInstance) {
  app.get('/api/coordinators', { preHandler: requireAdmin }, listCoordinators)

  app.post('/api/coordinators', { preHandler: requireAdmin }, async (request, reply) => {
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
      const coordinator = await db.transaction(async (tx) => {
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
            role: 'coordinator',
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
          await tx.insert(coordinatorEventAssignments).values(
            eventIds.map((eventId) => ({ coordinatorId: created.id, eventId })),
          )
        }
        return created
      })
      return reply.code(201).send({
        ...coordinator,
        events: eventIds.map((id) => ({ id })),
      })
    } catch (error) {
      if (error instanceof Error && error.message === 'EVENT_NOT_FOUND') {
        return reply.code(400).send({ message: 'One or more events do not exist' })
      }
      if (isRecord(error) && error.code === '23505') {
        return reply.code(409).send({ message: 'A user with this email already exists' })
      }
      throw error
    }
  })

  app.patch<{ Params: { coordinatorId: string } }>(
    '/api/coordinators/:coordinatorId',
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
        return reply.code(400).send({ message: 'Invalid coordinator profile' })
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
            and(
              eq(users.id, request.params.coordinatorId),
              eq(users.role, 'coordinator'),
            ),
          )
          .returning({
            id: users.id,
            email: users.email,
            firstName: users.firstName,
            lastName: users.lastName,
          })
        return updated ?? reply.code(404).send({ message: 'Coordinator not found' })
      } catch (error) {
        if (isRecord(error) && error.code === '23505') {
          return reply.code(409).send({ message: 'A user with this email already exists' })
        }
        throw error
      }
    },
  )

  app.put<{ Params: { coordinatorId: string } }>(
    '/api/coordinators/:coordinatorId/events',
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
        const [coordinator] = await tx
          .select({ id: users.id })
          .from(users)
          .where(
            and(
              eq(users.id, request.params.coordinatorId),
              eq(users.role, 'coordinator'),
            ),
          )
          .limit(1)
        if (!coordinator) return 'COORDINATOR_NOT_FOUND'

        if (eventIds.length) {
          const matchingEvents = await tx
            .select({ id: events.id })
            .from(events)
            .where(inArray(events.id, eventIds))
          if (matchingEvents.length !== eventIds.length) return 'EVENT_NOT_FOUND'
        }

        await tx
          .delete(coordinatorEventAssignments)
          .where(eq(coordinatorEventAssignments.coordinatorId, coordinator.id))
        if (eventIds.length) {
          await tx.insert(coordinatorEventAssignments).values(
            eventIds.map((eventId) => ({ coordinatorId: coordinator.id, eventId })),
          )
        }
        return 'OK'
      })

      if (result === 'COORDINATOR_NOT_FOUND') {
        return reply.code(404).send({ message: 'Coordinator not found' })
      }
      if (result === 'EVENT_NOT_FOUND') {
        return reply.code(400).send({ message: 'One or more events do not exist' })
      }
      return reply.code(204).send()
    },
  )

  app.delete<{ Params: { coordinatorId: string } }>(
    '/api/coordinators/:coordinatorId',
    { preHandler: requireAdmin },
    async (request, reply) => {
      const [deleted] = await db
        .delete(users)
        .where(
          and(
            eq(users.id, request.params.coordinatorId),
            eq(users.role, 'coordinator'),
          ),
        )
        .returning({ id: users.id })
      if (!deleted) return reply.code(404).send({ message: 'Coordinator not found' })
      return reply.code(204).send()
    },
  )
}
