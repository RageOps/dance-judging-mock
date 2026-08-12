import cookie from '@fastify/cookie'
import jwt from '@fastify/jwt'
import { and, asc, count, eq, inArray, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import Fastify from 'fastify'
import { db } from './db/client.js'
import {
  competitors,
  divisionPairs,
  divisionRegistrations,
  divisions,
  events,
  scoreSubmissions,
} from './db/schema.js'
import {
  requireAdmin,
  requireAuth,
  requireEventAccess,
} from './middleware/auth.js'
import { authRoutes } from './routes/auth.js'
import { judgeRoutes } from './routes/judges.js'
import { scoreRoutes } from './routes/scores.js'

const cookieName = 'judging_session'
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null
const nonEmptyString = (value: unknown) =>
  typeof value === 'string' && value.trim() ? value.trim() : null

export function buildApp() {
  const app = Fastify({ logger: true, trustProxy: true })
  const jwtSecret = process.env.JWT_SECRET
  if (!jwtSecret) throw new Error('JWT_SECRET is required')

  app.register(cookie)
  app.register(jwt, {
    secret: jwtSecret,
    cookie: { cookieName, signed: false },
  })

  app.get('/api/health', async () => ({ status: 'ok' }))
  app.register(authRoutes)
  app.register(judgeRoutes)
  app.register(scoreRoutes)

  app.get('/api/events', { preHandler: requireAdmin }, async () =>
    db.select().from(events).orderBy(asc(events.createdAt)),
  )

  app.post('/api/events', { preHandler: requireAdmin }, async (request, reply) => {
    const body = isRecord(request.body) ? request.body : {}
    const name = nonEmptyString(body.name)
    const eventDate = nonEmptyString(body.eventDate)
    if (!name) return reply.code(400).send({ message: 'Event name is required' })

    const [event] = await db
      .insert(events)
      .values({ name, eventDate: eventDate || null })
      .returning()
    return reply.code(201).send(event)
  })

  app.get<{ Params: { eventId: string } }>(
    '/api/events/:eventId',
    { preHandler: requireAuth },
    async (request, reply) => {
      if (!(await requireEventAccess(request, reply, request.params.eventId))) return
      const [event] = await db
        .select()
        .from(events)
        .where(eq(events.id, request.params.eventId))
        .limit(1)
      return event ?? reply.code(404).send({ message: 'Event not found' })
    },
  )

  app.get<{ Params: { eventId: string } }>(
    '/api/events/:eventId/competitors',
    { preHandler: requireAuth },
    async (request, reply) => {
      if (!(await requireEventAccess(request, reply, request.params.eventId))) return
      return db
        .select()
        .from(competitors)
        .where(eq(competitors.eventId, request.params.eventId))
        .orderBy(asc(competitors.bibNumber))
    },
  )

  app.post<{ Params: { eventId: string } }>(
    '/api/events/:eventId/competitors',
    { preHandler: requireAdmin },
    async (request, reply) => {
      const body = isRecord(request.body) ? request.body : {}
      const firstName = nonEmptyString(body.firstName)
      const lastName = nonEmptyString(body.lastName)
      if (!firstName || !lastName) {
        return reply.code(400).send({ message: 'First and last name are required' })
      }

      const competitor = await db.transaction(async (tx) => {
        const [event] = await tx
          .update(events)
          .set({ nextBibNumber: sql`${events.nextBibNumber} + 1` })
          .where(eq(events.id, request.params.eventId))
          .returning({ nextBibNumber: events.nextBibNumber })
        if (!event) return null
        const [created] = await tx
          .insert(competitors)
          .values({
            eventId: request.params.eventId,
            bibNumber: event.nextBibNumber - 1,
            firstName,
            lastName,
          })
          .returning()
        return created
      })
      if (!competitor) return reply.code(404).send({ message: 'Event not found' })
      return reply.code(201).send(competitor)
    },
  )

  app.patch<{ Params: { eventId: string; id: string } }>(
    '/api/events/:eventId/competitors/:id',
    { preHandler: requireAdmin },
    async (request, reply) => {
      const body = isRecord(request.body) ? request.body : {}
      const firstName = nonEmptyString(body.firstName)
      const lastName = nonEmptyString(body.lastName)
      if (!firstName || !lastName) {
        return reply.code(400).send({ message: 'First and last name are required' })
      }
      const [updated] = await db
        .update(competitors)
        .set({ firstName, lastName })
        .where(
          and(
            eq(competitors.id, request.params.id),
            eq(competitors.eventId, request.params.eventId),
          ),
        )
        .returning()
      return updated ?? reply.code(404).send({ message: 'Competitor not found' })
    },
  )

  app.delete<{ Params: { eventId: string; id: string } }>(
    '/api/events/:eventId/competitors/:id',
    { preHandler: requireAdmin },
    async (request, reply) => {
      const [registration] = await db
        .select({ competitorId: divisionRegistrations.competitorId })
        .from(divisionRegistrations)
        .where(eq(divisionRegistrations.competitorId, request.params.id))
        .limit(1)
      if (registration) {
        return reply
          .code(409)
          .send({ message: 'Remove this competitor from divisions before deleting' })
      }
      const [deleted] = await db
        .delete(competitors)
        .where(
          and(
            eq(competitors.id, request.params.id),
            eq(competitors.eventId, request.params.eventId),
          ),
        )
        .returning()
      if (!deleted) return reply.code(404).send({ message: 'Competitor not found' })
      return reply.code(204).send()
    },
  )

  app.get<{ Params: { eventId: string } }>(
    '/api/events/:eventId/divisions',
    { preHandler: requireAuth },
    async (request, reply) => {
      if (!(await requireEventAccess(request, reply, request.params.eventId))) return
      return db
        .select({
          id: divisions.id,
          eventId: divisions.eventId,
          name: divisions.name,
          type: divisions.type,
          showCompetitorNames: divisions.showCompetitorNames,
          createdAt: divisions.createdAt,
          registrationCount: count(divisionRegistrations.competitorId),
        })
        .from(divisions)
        .leftJoin(
          divisionRegistrations,
          eq(divisionRegistrations.divisionId, divisions.id),
        )
        .where(eq(divisions.eventId, request.params.eventId))
        .groupBy(divisions.id)
        .orderBy(asc(divisions.createdAt))
    },
  )

  app.post<{ Params: { eventId: string } }>(
    '/api/events/:eventId/divisions',
    { preHandler: requireAdmin },
    async (request, reply) => {
      const body = isRecord(request.body) ? request.body : {}
      const name = nonEmptyString(body.name)
      const type =
        body.type === 'jack_and_jill' || body.type === 'strictly' ? body.type : null
      const showCompetitorNames =
        typeof body.showCompetitorNames === 'boolean'
          ? body.showCompetitorNames
          : true
      if (!name || !type) {
        return reply.code(400).send({ message: 'Valid name and type are required' })
      }
      const [created] = await db
        .insert(divisions)
        .values({
          eventId: request.params.eventId,
          name,
          type,
          showCompetitorNames,
        })
        .returning()
      return reply.code(201).send(created)
    },
  )

  app.patch<{ Params: { eventId: string; id: string } }>(
    '/api/events/:eventId/divisions/:id',
    { preHandler: requireAdmin },
    async (request, reply) => {
      const body = isRecord(request.body) ? request.body : {}
      const name = nonEmptyString(body.name)
      const type =
        body.type === 'jack_and_jill' || body.type === 'strictly' ? body.type : null
      const showCompetitorNames =
        typeof body.showCompetitorNames === 'boolean'
          ? body.showCompetitorNames
          : undefined
      if (!name || !type) {
        return reply.code(400).send({ message: 'Valid name and type are required' })
      }
      const [updated] = await db
        .update(divisions)
        .set({ name, type, ...(showCompetitorNames === undefined ? {} : { showCompetitorNames }) })
        .where(
          and(
            eq(divisions.id, request.params.id),
            eq(divisions.eventId, request.params.eventId),
          ),
        )
        .returning()
      return updated ?? reply.code(404).send({ message: 'Division not found' })
    },
  )

  app.delete<{ Params: { eventId: string; id: string } }>(
    '/api/events/:eventId/divisions/:id',
    { preHandler: requireAdmin },
    async (request, reply) => {
      const [deleted] = await db
        .delete(divisions)
        .where(
          and(
            eq(divisions.id, request.params.id),
            eq(divisions.eventId, request.params.eventId),
          ),
        )
        .returning()
      if (!deleted) return reply.code(404).send({ message: 'Division not found' })
      return reply.code(204).send()
    },
  )

  app.get<{ Params: { eventId: string; divisionId: string } }>(
    '/api/events/:eventId/divisions/:divisionId/registrations',
    { preHandler: requireAuth },
    async (request, reply) => {
      const [division] = await db
        .select()
        .from(divisions)
        .where(
          and(
            eq(divisions.id, request.params.divisionId),
            eq(divisions.eventId, request.params.eventId),
          ),
        )
        .limit(1)
      if (!division) return reply.code(404).send({ message: 'Division not found' })
      if (!(await requireEventAccess(request, reply, request.params.eventId))) return
      return db
        .select({
          competitorId: competitors.id,
          bibNumber: competitors.bibNumber,
          firstName: competitors.firstName,
          lastName: competitors.lastName,
          role: divisionRegistrations.role,
        })
        .from(divisionRegistrations)
        .innerJoin(
          competitors,
          eq(competitors.id, divisionRegistrations.competitorId),
        )
        .where(eq(divisionRegistrations.divisionId, request.params.divisionId))
        .orderBy(asc(competitors.bibNumber))
    },
  )

  app.put<{ Params: { eventId: string; divisionId: string } }>(
    '/api/events/:eventId/divisions/:divisionId/registrations',
    { preHandler: requireAdmin },
    async (request, reply) => {
      const body = isRecord(request.body) ? request.body : {}
      const raw = Array.isArray(body.registrations) ? body.registrations : null
      if (!raw) return reply.code(400).send({ message: 'Registrations are required' })
      const registrations = raw.map((item) => {
        if (!isRecord(item)) return null
        const competitorId = nonEmptyString(item.competitorId)
        const role = item.role === 'lead' || item.role === 'follow' ? item.role : null
        return competitorId && role ? { competitorId, role } : null
      })
      if (registrations.some((item) => !item)) {
        return reply.code(400).send({ message: 'Each registration needs a competitor and role' })
      }
      const validRegistrations = registrations as Array<{
        competitorId: string
        role: 'lead' | 'follow'
      }>
      if (new Set(validRegistrations.map((item) => item.competitorId)).size !== validRegistrations.length) {
        return reply.code(400).send({ message: 'Competitors cannot be duplicated' })
      }

      const [division] = await db
        .select()
        .from(divisions)
        .where(
          and(
            eq(divisions.id, request.params.divisionId),
            eq(divisions.eventId, request.params.eventId),
          ),
        )
        .limit(1)
      if (!division) return reply.code(404).send({ message: 'Division not found' })

      const [startedSubmission] = await db
        .select({ divisionId: scoreSubmissions.divisionId })
        .from(scoreSubmissions)
        .where(eq(scoreSubmissions.divisionId, request.params.divisionId))
        .limit(1)
      if (startedSubmission) {
        return reply.code(409).send({
          message: 'Division registrations cannot change after scoring has started',
        })
      }

      if (validRegistrations.length) {
        const matching = await db
          .select({ id: competitors.id })
          .from(competitors)
          .where(
            and(
              eq(competitors.eventId, request.params.eventId),
              inArray(
                competitors.id,
                validRegistrations.map((item) => item.competitorId),
              ),
            ),
          )
        if (matching.length !== validRegistrations.length) {
          return reply.code(400).send({ message: 'All competitors must belong to this event' })
        }
      }

      await db.transaction(async (tx) => {
        await tx
          .delete(divisionPairs)
          .where(eq(divisionPairs.divisionId, request.params.divisionId))
        await tx
          .delete(divisionRegistrations)
          .where(eq(divisionRegistrations.divisionId, request.params.divisionId))
        if (validRegistrations.length) {
          await tx.insert(divisionRegistrations).values(
            validRegistrations.map((item) => ({
              divisionId: request.params.divisionId,
              ...item,
            })),
          )
        }
      })
      return reply.code(204).send()
    },
  )

  app.get<{ Params: { eventId: string; divisionId: string } }>(
    '/api/events/:eventId/divisions/:divisionId/pairs',
    { preHandler: requireAuth },
    async (request, reply) => {
      const [division] = await db
        .select()
        .from(divisions)
        .where(
          and(
            eq(divisions.id, request.params.divisionId),
            eq(divisions.eventId, request.params.eventId),
          ),
        )
        .limit(1)
      if (!division) return reply.code(404).send({ message: 'Division not found' })
      if (!(await requireEventAccess(request, reply, request.params.eventId))) return
      if (division.type !== 'strictly') {
        return reply.code(400).send({ message: 'Pairs are only used in Strictly divisions' })
      }

      const leadCompetitor = alias(competitors, 'lead_competitor')
      const followCompetitor = alias(competitors, 'follow_competitor')
      return db
        .select({
          leadCompetitorId: divisionPairs.leadCompetitorId,
          followCompetitorId: divisionPairs.followCompetitorId,
          leadBib: leadCompetitor.bibNumber,
          followBib: followCompetitor.bibNumber,
          leadFirstName: leadCompetitor.firstName,
          leadLastName: leadCompetitor.lastName,
          followFirstName: followCompetitor.firstName,
          followLastName: followCompetitor.lastName,
        })
        .from(divisionPairs)
        .innerJoin(
          leadCompetitor,
          eq(leadCompetitor.id, divisionPairs.leadCompetitorId),
        )
        .innerJoin(
          followCompetitor,
          eq(followCompetitor.id, divisionPairs.followCompetitorId),
        )
        .where(eq(divisionPairs.divisionId, request.params.divisionId))
        .orderBy(asc(leadCompetitor.bibNumber))
    },
  )

  app.put<{ Params: { eventId: string; divisionId: string } }>(
    '/api/events/:eventId/divisions/:divisionId/pairs',
    { preHandler: requireAdmin },
    async (request, reply) => {
      const body = isRecord(request.body) ? request.body : {}
      const raw = Array.isArray(body.pairs) ? body.pairs : null
      if (!raw) return reply.code(400).send({ message: 'Pairs are required' })

      const pairs = raw.map((item) => {
        if (!isRecord(item)) return null
        const leadCompetitorId = nonEmptyString(item.leadCompetitorId)
        const followCompetitorId = nonEmptyString(item.followCompetitorId)
        return leadCompetitorId && followCompetitorId
          ? { leadCompetitorId, followCompetitorId }
          : null
      })
      if (pairs.some((item) => !item)) {
        return reply.code(400).send({ message: 'Each pair needs a lead and follow' })
      }
      const validPairs = pairs as Array<{
        leadCompetitorId: string
        followCompetitorId: string
      }>

      const [division] = await db
        .select()
        .from(divisions)
        .where(
          and(
            eq(divisions.id, request.params.divisionId),
            eq(divisions.eventId, request.params.eventId),
          ),
        )
        .limit(1)
      if (!division) return reply.code(404).send({ message: 'Division not found' })
      if (division.type !== 'strictly') {
        return reply.code(400).send({ message: 'Pairs are only used in Strictly divisions' })
      }

      const [startedSubmission] = await db
        .select({ divisionId: scoreSubmissions.divisionId })
        .from(scoreSubmissions)
        .where(eq(scoreSubmissions.divisionId, request.params.divisionId))
        .limit(1)
      if (startedSubmission) {
        return reply.code(409).send({
          message: 'Division pairs cannot change after scoring has started',
        })
      }

      const registrations = await db
        .select({
          competitorId: divisionRegistrations.competitorId,
          role: divisionRegistrations.role,
        })
        .from(divisionRegistrations)
        .where(eq(divisionRegistrations.divisionId, request.params.divisionId))

      const leads = registrations.filter((row) => row.role === 'lead')
      const follows = registrations.filter((row) => row.role === 'follow')
      if (leads.length !== follows.length) {
        return reply
          .code(400)
          .send({ message: 'Strictly divisions need equal lead and follow counts before pairing' })
      }
      if (validPairs.length !== leads.length) {
        return reply
          .code(400)
          .send({ message: 'Every lead must be paired with exactly one follow' })
      }

      const leadIds = new Set(leads.map((row) => row.competitorId))
      const followIds = new Set(follows.map((row) => row.competitorId))
      const usedLeads = new Set<string>()
      const usedFollows = new Set<string>()
      for (const pair of validPairs) {
        if (
          !leadIds.has(pair.leadCompetitorId) ||
          !followIds.has(pair.followCompetitorId) ||
          usedLeads.has(pair.leadCompetitorId) ||
          usedFollows.has(pair.followCompetitorId) ||
          pair.leadCompetitorId === pair.followCompetitorId
        ) {
          return reply.code(400).send({ message: 'Invalid pair assignment' })
        }
        usedLeads.add(pair.leadCompetitorId)
        usedFollows.add(pair.followCompetitorId)
      }
      if (usedLeads.size !== leads.length || usedFollows.size !== follows.length) {
        return reply
          .code(400)
          .send({ message: 'Every lead and follow must appear in exactly one pair' })
      }

      await db.transaction(async (tx) => {
        await tx
          .delete(divisionPairs)
          .where(eq(divisionPairs.divisionId, request.params.divisionId))
        if (validPairs.length) {
          await tx.insert(divisionPairs).values(
            validPairs.map((pair) => ({
              divisionId: request.params.divisionId,
              ...pair,
            })),
          )
        }
      })
      return reply.code(204).send()
    },
  )

  return app
}
