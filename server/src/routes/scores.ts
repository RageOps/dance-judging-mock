import { and, asc, count, eq, inArray, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import type { FastifyInstance } from 'fastify'
import { db } from '../db/client.js'
import {
  competitors,
  divisionPairs,
  divisionRegistrations,
  divisions,
  events,
  judgeEventAssignments,
  scores,
  scoreSubmissions,
  users,
} from '../db/schema.js'
import {
  requireAuth,
  requireEventAccess,
} from '../middleware/auth.js'

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null
type Scope = 'lead' | 'follow' | 'both'
const isScope = (value: unknown): value is Scope =>
  value === 'lead' || value === 'follow' || value === 'both'

async function validateDivision(eventId: string, divisionId: string) {
  const [division] = await db
    .select()
    .from(divisions)
    .where(and(eq(divisions.id, divisionId), eq(divisions.eventId, eventId)))
    .limit(1)
  return division
}

export async function scoreRoutes(app: FastifyInstance) {
  app.get('/api/judge/events', { preHandler: requireAuth }, async (request, reply) => {
    if (request.user.role !== 'judge') {
      return reply.code(403).send({ message: 'Judge access required' })
    }
    return db
      .select({
        id: events.id,
        name: events.name,
        eventDate: events.eventDate,
        createdAt: events.createdAt,
      })
      .from(judgeEventAssignments)
      .innerJoin(events, eq(events.id, judgeEventAssignments.eventId))
      .where(eq(judgeEventAssignments.judgeId, request.user.id))
      .orderBy(asc(events.eventDate), asc(events.name))
  })

  app.get<{ Params: { eventId: string } }>(
    '/api/judge/events/:eventId/divisions',
    { preHandler: requireAuth },
    async (request, reply) => {
      if (request.user.role !== 'judge') {
        return reply.code(403).send({ message: 'Judge access required' })
      }
      if (!(await requireEventAccess(request, reply, request.params.eventId))) return

      const divisionRows = await db
        .select()
        .from(divisions)
        .where(eq(divisions.eventId, request.params.eventId))
        .orderBy(asc(divisions.createdAt))
      const divisionIds = divisionRows.map((division) => division.id)
      if (!divisionIds.length) return []

      const registrationCounts = await db
        .select({
          divisionId: divisionRegistrations.divisionId,
          value: count(),
        })
        .from(divisionRegistrations)
        .where(inArray(divisionRegistrations.divisionId, divisionIds))
        .groupBy(divisionRegistrations.divisionId)
      const submissions = await db
        .select()
        .from(scoreSubmissions)
        .where(
          and(
            eq(scoreSubmissions.judgeId, request.user.id),
            inArray(scoreSubmissions.divisionId, divisionIds),
          ),
        )

      return divisionRows.map((division) => {
        const submission = submissions.find(
          (item) => item.divisionId === division.id,
        )
        return {
          ...division,
          competitorCount: Number(
            registrationCounts.find((item) => item.divisionId === division.id)
              ?.value ?? 0,
          ),
          submissionStatus: submission?.status ?? 'not_started',
          revision: submission?.revision ?? 0,
        }
      })
    },
  )

  app.get<{ Params: { eventId: string; divisionId: string } }>(
    '/api/judge/events/:eventId/divisions/:divisionId/scores',
    { preHandler: requireAuth },
    async (request, reply) => {
      if (request.user.role !== 'judge') {
        return reply.code(403).send({ message: 'Judge access required' })
      }
      if (!(await requireEventAccess(request, reply, request.params.eventId))) return
      const division = await validateDivision(
        request.params.eventId,
        request.params.divisionId,
      )
      if (!division) return reply.code(404).send({ message: 'Division not found' })

      const [event] = await db
        .select()
        .from(events)
        .where(eq(events.id, request.params.eventId))
        .limit(1)
      const [submission] = await db
        .select()
        .from(scoreSubmissions)
        .where(
          and(
            eq(scoreSubmissions.judgeId, request.user.id),
            eq(scoreSubmissions.divisionId, request.params.divisionId),
          ),
        )
        .limit(1)

      if (division.type === 'strictly') {
        const leadCompetitor = alias(competitors, 'lead_competitor')
        const followCompetitor = alias(competitors, 'follow_competitor')
        const pairRows = await db
          .select({
            competitorId: divisionPairs.leadCompetitorId,
            followCompetitorId: divisionPairs.followCompetitorId,
            bibNumber: leadCompetitor.bibNumber,
            leadFirstName: leadCompetitor.firstName,
            leadLastName: leadCompetitor.lastName,
            followFirstName: followCompetitor.firstName,
            followLastName: followCompetitor.lastName,
            score: scores.score,
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
          .leftJoin(
            scores,
            and(
              eq(scores.judgeId, request.user.id),
              eq(scores.divisionId, request.params.divisionId),
              eq(scores.competitorId, divisionPairs.leadCompetitorId),
            ),
          )
          .where(eq(divisionPairs.divisionId, request.params.divisionId))
          .orderBy(asc(leadCompetitor.bibNumber))

        return {
          event,
          division,
          scoringMode: 'pairs' as const,
          status: submission?.status ?? 'editing',
          scope: submission?.scope ?? 'lead',
          revision: submission?.revision ?? 0,
          submittedAt: submission?.submittedAt ?? null,
          competitors: pairRows.map((pair) => ({
            competitorId: pair.competitorId,
            followCompetitorId: pair.followCompetitorId,
            bibNumber: pair.bibNumber,
            leadFirstName: division.showCompetitorNames
              ? pair.leadFirstName
              : undefined,
            followFirstName: division.showCompetitorNames
              ? pair.followFirstName
              : undefined,
            score: pair.score,
          })),
        }
      }

      const rows = await db
        .select({
          competitorId: competitors.id,
          bibNumber: competitors.bibNumber,
          firstName: competitors.firstName,
          lastName: competitors.lastName,
          role: divisionRegistrations.role,
          score: scores.score,
        })
        .from(divisionRegistrations)
        .innerJoin(
          competitors,
          eq(competitors.id, divisionRegistrations.competitorId),
        )
        .leftJoin(
          scores,
          and(
            eq(scores.judgeId, request.user.id),
            eq(scores.divisionId, request.params.divisionId),
            eq(scores.competitorId, competitors.id),
          ),
        )
        .where(eq(divisionRegistrations.divisionId, request.params.divisionId))
        .orderBy(asc(competitors.bibNumber))

      return {
        event,
        division,
        scoringMode: 'individual' as const,
        status: submission?.status ?? 'editing',
        scope: submission?.scope ?? 'both',
        revision: submission?.revision ?? 0,
        submittedAt: submission?.submittedAt ?? null,
        competitors: rows.map((competitor) => ({
          ...competitor,
          firstName: division.showCompetitorNames
            ? competitor.firstName
            : undefined,
          lastName: division.showCompetitorNames
            ? competitor.lastName
            : undefined,
        })),
      }
    },
  )

  app.post<{ Params: { eventId: string; divisionId: string } }>(
    '/api/judge/events/:eventId/divisions/:divisionId/scores/edit',
    { preHandler: requireAuth },
    async (request, reply) => {
      if (request.user.role !== 'judge') {
        return reply.code(403).send({ message: 'Judge access required' })
      }
      if (!(await requireEventAccess(request, reply, request.params.eventId))) return
      if (
        !(await validateDivision(
          request.params.eventId,
          request.params.divisionId,
        ))
      ) {
        return reply.code(404).send({ message: 'Division not found' })
      }
      const body = isRecord(request.body) ? request.body : {}
      const expectedRevision = body.expectedRevision
      if (!Number.isInteger(expectedRevision) || Number(expectedRevision) < 1) {
        return reply.code(400).send({ message: 'Expected revision is required' })
      }

      const [updated] = await db
        .update(scoreSubmissions)
        .set({ status: 'editing', updatedAt: new Date() })
        .where(
          and(
            eq(scoreSubmissions.judgeId, request.user.id),
            eq(scoreSubmissions.divisionId, request.params.divisionId),
            eq(scoreSubmissions.status, 'locked'),
            eq(scoreSubmissions.revision, Number(expectedRevision)),
          ),
        )
        .returning()
      if (!updated) {
        return reply
          .code(409)
          .send({ message: 'Scores changed elsewhere; refresh and try again' })
      }
      return updated
    },
  )

  app.put<{ Params: { eventId: string; divisionId: string } }>(
    '/api/judge/events/:eventId/divisions/:divisionId/scores',
    { preHandler: requireAuth },
    async (request, reply) => {
      if (request.user.role !== 'judge') {
        return reply.code(403).send({ message: 'Judge access required' })
      }
      if (!(await requireEventAccess(request, reply, request.params.eventId))) return
      const division = await validateDivision(
        request.params.eventId,
        request.params.divisionId,
      )
      if (!division) return reply.code(404).send({ message: 'Division not found' })

      const body = isRecord(request.body) ? request.body : {}
      const expectedRevision = body.expectedRevision
      const scopeInput = body.scope
      const rawScores = Array.isArray(body.scores) ? body.scores : null
      const isStrictly = division.type === 'strictly'
      const scope: Scope = isStrictly
        ? 'lead'
        : isScope(scopeInput)
          ? scopeInput
          : 'both'
      if (
        !Number.isInteger(expectedRevision) ||
        Number(expectedRevision) < 0 ||
        !rawScores ||
        (!isStrictly && !isScope(scopeInput))
      ) {
        return reply.code(400).send({ message: 'Scores and expected revision are required' })
      }
      const submittedScores = rawScores.map((item) => {
        if (!isRecord(item)) return null
        const competitorId =
          typeof item.competitorId === 'string' ? item.competitorId : null
        const score = item.score
        return competitorId &&
          Number.isInteger(score) &&
          Number(score) >= 1 &&
          Number(score) <= 10
          ? { competitorId, score: Number(score) }
          : null
      })
      if (
        submittedScores.some((item) => !item) ||
        new Set(submittedScores.map((item) => item?.competitorId)).size !==
          submittedScores.length
      ) {
        return reply.code(400).send({ message: 'Every score must be a unique integer from 1 to 10' })
      }
      const validScores = submittedScores as Array<{
        competitorId: string
        score: number
      }>

      if (isStrictly) {
        const pairRows = await db
          .select({ leadCompetitorId: divisionPairs.leadCompetitorId })
          .from(divisionPairs)
          .where(eq(divisionPairs.divisionId, request.params.divisionId))
        const leadIds = new Set(pairRows.map((row) => row.leadCompetitorId))
        if (!pairRows.length) {
          return reply.code(400).send({ message: 'Division pairs must be configured before scoring' })
        }
        if (
          validScores.length !== pairRows.length ||
          validScores.some((item) => !leadIds.has(item.competitorId))
        ) {
          return reply
            .code(400)
            .send({ message: 'A score is required for every pair using the lead competitor id' })
        }
      } else {
        const registrations = await db
          .select({
            competitorId: divisionRegistrations.competitorId,
            role: divisionRegistrations.role,
          })
          .from(divisionRegistrations)
          .where(eq(divisionRegistrations.divisionId, request.params.divisionId))
        const scopedRegistrations = registrations.filter(
          (registration) => scope === 'both' || registration.role === scope,
        )
        const registeredIds = new Set(
          scopedRegistrations.map((row) => row.competitorId),
        )
        if (
          validScores.length !== scopedRegistrations.length ||
          validScores.some((item) => !registeredIds.has(item.competitorId))
        ) {
          return reply
            .code(400)
            .send({ message: 'A score is required for every competitor in the selected scope' })
        }
      }

      const now = new Date()
      const result = await db.transaction(async (tx) => {
        let nextRevision: number
        if (Number(expectedRevision) === 0) {
          const [created] = await tx
            .insert(scoreSubmissions)
            .values({
              judgeId: request.user.id,
              divisionId: request.params.divisionId,
              status: 'locked',
              scope,
              revision: 1,
              submittedAt: now,
              updatedAt: now,
            })
            .onConflictDoNothing()
            .returning({ revision: scoreSubmissions.revision })
          if (!created) return null
          nextRevision = created.revision
        } else {
          const [updated] = await tx
            .update(scoreSubmissions)
            .set({
              status: 'locked',
              scope,
              revision: sql`${scoreSubmissions.revision} + 1`,
              submittedAt: now,
              updatedAt: now,
            })
            .where(
              and(
                eq(scoreSubmissions.judgeId, request.user.id),
                eq(scoreSubmissions.divisionId, request.params.divisionId),
                eq(scoreSubmissions.status, 'editing'),
                eq(scoreSubmissions.revision, Number(expectedRevision)),
              ),
            )
            .returning({ revision: scoreSubmissions.revision })
          if (!updated) return null
          nextRevision = updated.revision
        }

        await tx
          .delete(scores)
          .where(
            and(
              eq(scores.judgeId, request.user.id),
              eq(scores.divisionId, request.params.divisionId),
            ),
          )
        if (validScores.length) {
          await tx.insert(scores).values(
            validScores.map((item) => ({
              judgeId: request.user.id,
              divisionId: request.params.divisionId,
              competitorId: item.competitorId,
              score: item.score,
              updatedAt: now,
            })),
          )
        }
        return nextRevision
      })

      if (result === null) {
        return reply.code(409).send({
          message: 'Scores are locked or changed elsewhere; refresh and try again',
        })
      }
      return {
        status: 'locked',
        revision: result,
        submittedAt: now,
      }
    },
  )

  app.get<{ Params: { eventId: string; divisionId: string } }>(
    '/api/events/:eventId/divisions/:divisionId/status',
    { preHandler: requireAuth },
    async (request, reply) => {
      if (!(await requireEventAccess(request, reply, request.params.eventId))) return
      const division = await validateDivision(
        request.params.eventId,
        request.params.divisionId,
      )
      if (!division) return reply.code(404).send({ message: 'Division not found' })

      const [event] = await db
        .select()
        .from(events)
        .where(eq(events.id, request.params.eventId))
        .limit(1)
      const assignedJudges = await db
        .select({
          id: users.id,
          firstName: users.firstName,
          lastName: users.lastName,
        })
        .from(judgeEventAssignments)
        .innerJoin(users, eq(users.id, judgeEventAssignments.judgeId))
        .where(eq(judgeEventAssignments.eventId, request.params.eventId))
        .orderBy(asc(users.lastName), asc(users.firstName))
      const submissions = await db
        .select()
        .from(scoreSubmissions)
        .where(eq(scoreSubmissions.divisionId, request.params.divisionId))
      const registrationRows = await db
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
      const lockedScoreRows = await db
        .select({
          judgeId: scores.judgeId,
          competitorId: scores.competitorId,
          score: scores.score,
        })
        .from(scores)
        .innerJoin(
          scoreSubmissions,
          and(
            eq(scoreSubmissions.judgeId, scores.judgeId),
            eq(scoreSubmissions.divisionId, scores.divisionId),
          ),
        )
        .where(
          and(
            eq(scores.divisionId, request.params.divisionId),
            eq(scoreSubmissions.status, 'locked'),
          ),
        )

      const assignedJudgeIds = new Set(assignedJudges.map((judge) => judge.id))
      const showNames =
        request.user.role === 'admin' ||
        request.user.role === 'coordinator' ||
        division.showCompetitorNames
      const judgeStatuses = assignedJudges.map((judge) => {
        const submission = submissions.find(
          (item) => item.judgeId === judge.id,
        )
        return {
          ...judge,
          status: submission?.status ?? 'not_started',
          scope: submission?.scope ?? null,
          submittedAt: submission?.submittedAt ?? null,
        }
      })
      const resultRows = registrationRows
        .map((competitor) => {
          const competitorScores = lockedScoreRows.filter(
            (row) =>
              row.competitorId === competitor.competitorId &&
              assignedJudgeIds.has(row.judgeId),
          )
          if (!competitorScores.length) return null
          const average =
            competitorScores.reduce((sum, row) => sum + row.score, 0) /
            competitorScores.length
          return {
            ...competitor,
            firstName: showNames ? competitor.firstName : undefined,
            lastName: showNames ? competitor.lastName : undefined,
            submittedScoreCount: competitorScores.length,
            average: Math.round(average * 100) / 100,
          }
        })
        .filter((row) => row !== null)

      const sortResults = (role: 'lead' | 'follow') =>
        resultRows
          .filter((row) => row.role === role)
          .sort(
            (left, right) =>
              right.average - left.average || left.bibNumber - right.bibNumber,
          )

      if (division.type === 'strictly') {
        const leadCompetitor = alias(competitors, 'lead_competitor')
        const followCompetitor = alias(competitors, 'follow_competitor')
        const pairRows = await db
          .select({
            leadCompetitorId: divisionPairs.leadCompetitorId,
            leadBibNumber: leadCompetitor.bibNumber,
            leadFirstName: leadCompetitor.firstName,
            followFirstName: followCompetitor.firstName,
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

        const pairResults = pairRows
          .map((pair) => {
            const pairScores = lockedScoreRows.filter(
              (row) =>
                row.competitorId === pair.leadCompetitorId &&
                assignedJudgeIds.has(row.judgeId),
            )
            if (!pairScores.length) return null
            const average =
              pairScores.reduce((sum, row) => sum + row.score, 0) /
              pairScores.length
            return {
              leadCompetitorId: pair.leadCompetitorId,
              leadBibNumber: pair.leadBibNumber,
              leadFirstName: showNames ? pair.leadFirstName : undefined,
              followFirstName: showNames ? pair.followFirstName : undefined,
              submittedScoreCount: pairScores.length,
              average: Math.round(average * 100) / 100,
            }
          })
          .filter((row) => row !== null)
          .sort(
            (left, right) =>
              right.average - left.average ||
              left.leadBibNumber - right.leadBibNumber,
          )

        return {
          event,
          division,
          judges: {
            submitted: judgeStatuses.filter((judge) => judge.status === 'locked'),
            pending: judgeStatuses.filter((judge) => judge.status !== 'locked'),
          },
          preliminaryResults: {
            leads: [],
            follows: [],
            pairs: pairResults,
          },
        }
      }

      return {
        event,
        division,
        judges: {
          submitted: judgeStatuses.filter((judge) => judge.status === 'locked'),
          pending: judgeStatuses.filter((judge) => judge.status !== 'locked'),
        },
        preliminaryResults: {
          leads: sortResults('lead'),
          follows: sortResults('follow'),
          pairs: [],
        },
      }
    },
  )
}
