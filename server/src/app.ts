import cookie from '@fastify/cookie'
import jwt from '@fastify/jwt'
import { and, asc, count, eq, inArray, or, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import Fastify from 'fastify'
import { db } from './db/client.js'
import {
  callbackVotes,
  competitors,
  coordinatorEventAssignments,
  divisionPairs,
  divisionRegistrations,
  divisionRounds,
  divisions,
  events,
  heatEntries,
  heats,
  placements,
  roundSubmissions,
  scores,
  scoreSubmissions,
} from './db/schema.js'
import {
  requireAdmin,
  requireAuth,
  requireEventAccess,
  requireEventManager,
  requireEventManagerAccess,
} from './middleware/auth.js'
import { authRoutes } from './routes/auth.js'
import { coordinatorRoutes } from './routes/coordinators.js'
import { judgeRoutes } from './routes/judges.js'
import { roundRoutes } from './routes/rounds.js'
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
  app.register(coordinatorRoutes)
  app.register(scoreRoutes)
  app.register(roundRoutes)

  app.get('/api/events', { preHandler: requireEventManager }, async (request, reply) => {
    if (request.user.role === 'admin') {
      return db.select().from(events).orderBy(asc(events.createdAt))
    }
    return db
      .select({
        id: events.id,
        name: events.name,
        eventDate: events.eventDate,
        nextBibNumber: events.nextBibNumber,
        createdAt: events.createdAt,
      })
      .from(coordinatorEventAssignments)
      .innerJoin(events, eq(events.id, coordinatorEventAssignments.eventId))
      .where(eq(coordinatorEventAssignments.coordinatorId, request.user.id))
      .orderBy(asc(events.createdAt))
  })

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
      const [competitorRows, registrationRows] = await Promise.all([
        db
          .select()
          .from(competitors)
          .where(eq(competitors.eventId, request.params.eventId))
          .orderBy(asc(competitors.bibNumber)),
        db
          .select({
            competitorId: divisionRegistrations.competitorId,
            divisionId: divisions.id,
            divisionName: divisions.name,
            divisionType: divisions.type,
            role: divisionRegistrations.role,
          })
          .from(divisionRegistrations)
          .innerJoin(
            divisions,
            eq(divisions.id, divisionRegistrations.divisionId),
          )
          .where(eq(divisions.eventId, request.params.eventId)),
      ])
      const divisionsByCompetitor = new Map<
        string,
        Array<{ id: string; name: string; type: string; role: string }>
      >()
      for (const row of registrationRows) {
        const list = divisionsByCompetitor.get(row.competitorId) ?? []
        list.push({
          id: row.divisionId,
          name: row.divisionName,
          type: row.divisionType,
          role: row.role,
        })
        divisionsByCompetitor.set(row.competitorId, list)
      }
      return competitorRows.map((competitor) => ({
        ...competitor,
        divisions: divisionsByCompetitor.get(competitor.id) ?? [],
      }))
    },
  )

  app.post<{ Params: { eventId: string } }>(
    '/api/events/:eventId/competitors',
    { preHandler: requireAuth },
    async (request, reply) => {
      if (!(await requireEventManagerAccess(request, reply, request.params.eventId))) return
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

  app.put<{ Params: { eventId: string; id: string } }>(
    '/api/events/:eventId/competitors/:id/check-in',
    { preHandler: requireAuth },
    async (request, reply) => {
      if (!(await requireEventManagerAccess(request, reply, request.params.eventId))) return
      const body = isRecord(request.body) ? request.body : {}
      const bibNumber =
        typeof body.bibNumber === 'number' && Number.isInteger(body.bibNumber)
          ? body.bibNumber
          : null
      if (!bibNumber || bibNumber < 1) {
        return reply.code(400).send({ message: 'A positive bib number is required' })
      }

      const [competitor] = await db
        .select()
        .from(competitors)
        .where(
          and(
            eq(competitors.id, request.params.id),
            eq(competitors.eventId, request.params.eventId),
          ),
        )
        .limit(1)
      if (!competitor) return reply.code(404).send({ message: 'Competitor not found' })

      const [bibTaken] = await db
        .select({ id: competitors.id })
        .from(competitors)
        .where(
          and(
            eq(competitors.eventId, request.params.eventId),
            eq(competitors.bibNumber, bibNumber),
          ),
        )
        .limit(1)
      if (bibTaken && bibTaken.id !== competitor.id) {
        return reply.code(409).send({ message: 'Bib number is already assigned' })
      }

      const [updated] = await db
        .update(competitors)
        .set({ bibNumber, checkedInAt: sql`now()` })
        .where(eq(competitors.id, competitor.id))
        .returning()
      return updated
    },
  )

  app.delete<{ Params: { eventId: string; id: string } }>(
    '/api/events/:eventId/competitors/:id/check-in',
    { preHandler: requireAuth },
    async (request, reply) => {
      if (!(await requireEventManagerAccess(request, reply, request.params.eventId))) return
      const [updated] = await db
        .update(competitors)
        .set({ checkedInAt: null })
        .where(
          and(
            eq(competitors.id, request.params.id),
            eq(competitors.eventId, request.params.eventId),
          ),
        )
        .returning()
      if (!updated) return reply.code(404).send({ message: 'Competitor not found' })
      return reply.code(204).send()
    },
  )

  app.patch<{ Params: { eventId: string; id: string } }>(
    '/api/events/:eventId/competitors/:id',
    { preHandler: requireAuth },
    async (request, reply) => {
      if (!(await requireEventManagerAccess(request, reply, request.params.eventId))) return
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
    { preHandler: requireAuth },
    async (request, reply) => {
      if (!(await requireEventManagerAccess(request, reply, request.params.eventId))) return
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
          scoringMode: divisions.scoringMode,
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
    { preHandler: requireAuth },
    async (request, reply) => {
      if (!(await requireEventManagerAccess(request, reply, request.params.eventId))) return
      const body = isRecord(request.body) ? request.body : {}
      const name = nonEmptyString(body.name)
      const type =
        body.type === 'jack_and_jill' || body.type === 'strictly' ? body.type : null
      const scoringMode =
        body.scoringMode === 'numeric' || body.scoringMode === 'rounds'
          ? body.scoringMode
          : 'numeric'
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
          scoringMode,
          showCompetitorNames,
        })
        .returning()
      return reply.code(201).send(created)
    },
  )

  app.patch<{ Params: { eventId: string; id: string } }>(
    '/api/events/:eventId/divisions/:id',
    { preHandler: requireAuth },
    async (request, reply) => {
      if (!(await requireEventManagerAccess(request, reply, request.params.eventId))) return
      const body = isRecord(request.body) ? request.body : {}
      const name = nonEmptyString(body.name)
      const type =
        body.type === 'jack_and_jill' || body.type === 'strictly' ? body.type : null
      const scoringMode =
        body.scoringMode === 'numeric' || body.scoringMode === 'rounds'
          ? body.scoringMode
          : undefined
      const showCompetitorNames =
        typeof body.showCompetitorNames === 'boolean'
          ? body.showCompetitorNames
          : undefined
      if (!name || !type) {
        return reply.code(400).send({ message: 'Valid name and type are required' })
      }
      const [updated] = await db
        .update(divisions)
        .set({
          name,
          type,
          ...(scoringMode === undefined ? {} : { scoringMode }),
          ...(showCompetitorNames === undefined ? {} : { showCompetitorNames }),
        })
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
    { preHandler: requireAuth },
    async (request, reply) => {
      if (!(await requireEventManagerAccess(request, reply, request.params.eventId))) return
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
          checkedInAt: divisionRegistrations.checkedInAt,
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
    { preHandler: requireAuth },
    async (request, reply) => {
      if (!(await requireEventManagerAccess(request, reply, request.params.eventId))) return
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
      const [startedRound] = await db
        .select({ id: divisionRounds.id })
        .from(divisionRounds)
        .innerJoin(
          roundSubmissions,
          eq(roundSubmissions.roundId, divisionRounds.id),
        )
        .where(eq(divisionRounds.divisionId, request.params.divisionId))
        .limit(1)
      if (startedSubmission || startedRound) {
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

  app.put<{ Params: { eventId: string; divisionId: string } }>(
    '/api/events/:eventId/divisions/:divisionId/check-in',
    { preHandler: requireAuth },
    async (request, reply) => {
      if (!(await requireEventManagerAccess(request, reply, request.params.eventId))) return
      const body = isRecord(request.body) ? request.body : {}
      const raw = Array.isArray(body.competitorIds) ? body.competitorIds : null
      if (!raw || raw.some((id) => typeof id !== 'string')) {
        return reply.code(400).send({ message: 'Competitor IDs are required' })
      }
      const competitorIds = [...new Set(raw as string[])]

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

      const registered = await db
        .select({ competitorId: divisionRegistrations.competitorId })
        .from(divisionRegistrations)
        .where(eq(divisionRegistrations.divisionId, request.params.divisionId))
      const registeredIds = new Set(registered.map((row) => row.competitorId))
      if (competitorIds.some((id) => !registeredIds.has(id))) {
        return reply
          .code(400)
          .send({ message: 'Checked-in competitors must be registered in the division' })
      }

      await db.transaction(async (tx) => {
        await tx
          .update(divisionRegistrations)
          .set({ checkedInAt: null })
          .where(eq(divisionRegistrations.divisionId, request.params.divisionId))
        if (competitorIds.length) {
          await tx
            .update(divisionRegistrations)
            .set({ checkedInAt: sql`now()` })
            .where(
              and(
                eq(divisionRegistrations.divisionId, request.params.divisionId),
                inArray(divisionRegistrations.competitorId, competitorIds),
              ),
            )
        }
      })
      return reply.code(204).send()
    },
  )

  app.delete<{ Params: { eventId: string; divisionId: string; competitorId: string } }>(
    '/api/events/:eventId/divisions/:divisionId/registrations/:competitorId',
    { preHandler: requireAuth },
    async (request, reply) => {
      if (!(await requireEventManagerAccess(request, reply, request.params.eventId))) return
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

      const scratched = await db.transaction(async (tx) => {
        const [deleted] = await tx
          .delete(divisionRegistrations)
          .where(
            and(
              eq(divisionRegistrations.divisionId, request.params.divisionId),
              eq(divisionRegistrations.competitorId, request.params.competitorId),
            ),
          )
          .returning()
        if (!deleted) return null
        await tx
          .delete(divisionPairs)
          .where(
            and(
              eq(divisionPairs.divisionId, request.params.divisionId),
              or(
                eq(divisionPairs.leadCompetitorId, request.params.competitorId),
                eq(divisionPairs.followCompetitorId, request.params.competitorId),
              ),
            ),
          )
        await tx
          .delete(scores)
          .where(
            and(
              eq(scores.divisionId, request.params.divisionId),
              eq(scores.competitorId, request.params.competitorId),
            ),
          )
        const divisionRoundIds = (
          await tx
            .select({ id: divisionRounds.id })
            .from(divisionRounds)
            .where(eq(divisionRounds.divisionId, request.params.divisionId))
        ).map((round) => round.id)
        if (divisionRoundIds.length) {
          const divisionHeatIds = (
            await tx
              .select({ id: heats.id })
              .from(heats)
              .where(inArray(heats.roundId, divisionRoundIds))
          ).map((heat) => heat.id)
          if (divisionHeatIds.length) {
            await tx
              .delete(heatEntries)
              .where(
                and(
                  eq(heatEntries.competitorId, request.params.competitorId),
                  inArray(heatEntries.heatId, divisionHeatIds),
                ),
              )
          }
          await tx
            .delete(callbackVotes)
            .where(
              and(
                eq(callbackVotes.competitorId, request.params.competitorId),
                inArray(callbackVotes.roundId, divisionRoundIds),
              ),
            )
          await tx
            .delete(placements)
            .where(
              and(
                eq(placements.competitorId, request.params.competitorId),
                inArray(placements.roundId, divisionRoundIds),
              ),
            )
        }
        return deleted
      })
      if (!scratched) return reply.code(404).send({ message: 'Registration not found' })
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
    { preHandler: requireAuth },
    async (request, reply) => {
      if (!(await requireEventManagerAccess(request, reply, request.params.eventId))) return
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
      const [startedRound] = await db
        .select({ id: divisionRounds.id })
        .from(divisionRounds)
        .innerJoin(
          roundSubmissions,
          eq(roundSubmissions.roundId, divisionRounds.id),
        )
        .where(eq(divisionRounds.divisionId, request.params.divisionId))
        .limit(1)
      if (startedSubmission || startedRound) {
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
