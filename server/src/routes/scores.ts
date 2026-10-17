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
import { computeRelativePlacement } from '../relativePlacement.js'

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

async function lockedScoreBallots(eventId: string, divisionId: string) {
  const [assigned, scoreRows] = await Promise.all([
    db
      .select({ judgeId: judgeEventAssignments.judgeId })
      .from(judgeEventAssignments)
      .where(eq(judgeEventAssignments.eventId, eventId)),
    db
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
          eq(scores.divisionId, divisionId),
          eq(scoreSubmissions.status, 'locked'),
        ),
      ),
  ])
  const assignedJudgeIds = new Set(assigned.map((row) => row.judgeId))
  const ballots = new Map<string, Map<string, number>>()
  for (const row of scoreRows) {
    if (!assignedJudgeIds.has(row.judgeId)) continue
    const ballot = ballots.get(row.judgeId) ?? new Map()
    ballot.set(row.competitorId, row.score)
    ballots.set(row.judgeId, ballot)
  }
  return ballots
}

// Each judge's ballot counts as a "yes" for their own top-N scores in the
// group (ties at the judge's cutoff all count). Advancing entries are those
// with yes-counts at or above the group's Nth highest count.
function advancementYesCounts(
  competitorIds: string[],
  ballots: Map<string, Map<string, number>>,
  advanceCount: number,
) {
  const yes = new Map(competitorIds.map((id) => [id, 0]))
  for (const ballot of ballots.values()) {
    const scored = competitorIds
      .map((id) => ballot.get(id))
      .filter((score): score is number => score !== undefined)
    if (!scored.length) continue
    const cutoff = scored.sort((a, b) => b - a)[
      Math.min(advanceCount, scored.length) - 1
    ]!
    for (const id of competitorIds) {
      const score = ballot.get(id)
      if (score !== undefined && score >= cutoff) {
        yes.set(id, yes.get(id)! + 1)
      }
    }
  }
  const sortedYes = [...yes.values()].sort((a, b) => b - a)
  const cutoffYes = sortedYes[Math.min(advanceCount, sortedYes.length) - 1]
  const advancing = new Set(
    [...yes]
      .filter(([, count]) => cutoffYes !== undefined && count >= cutoffYes)
      .map(([id]) => id),
  )
  return { points: yes, advancing }
}

async function advancementGroups(
  eventId: string,
  division: {
    id: string
    type: 'jack_and_jill' | 'strictly'
    advanceCount: number | null
  },
) {
  if (!division.advanceCount || division.advanceCount < 1) return null
  const ballots = await lockedScoreBallots(eventId, division.id)
  const tally = (
    entries: Array<{ competitorId: string; bibNumber: number }>,
  ) => {
    const { points, advancing } = advancementYesCounts(
      entries.map((entry) => entry.competitorId),
      ballots,
      division.advanceCount!,
    )
    return entries
      .map((entry) => ({
        competitorId: entry.competitorId,
        bibNumber: entry.bibNumber,
        points: points.get(entry.competitorId) ?? 0,
        advancing: advancing.has(entry.competitorId),
      }))
      .sort(
        (left, right) =>
          right.points - left.points || left.bibNumber - right.bibNumber,
      )
  }
  if (division.type === 'strictly') {
    const pairEntries = await db
      .select({
        competitorId: divisionPairs.leadCompetitorId,
        bibNumber: competitors.bibNumber,
      })
      .from(divisionPairs)
      .innerJoin(
        competitors,
        eq(competitors.id, divisionPairs.leadCompetitorId),
      )
      .where(eq(divisionPairs.divisionId, division.id))
    return {
      advanceCount: division.advanceCount,
      groups: [{ role: 'pair' as const, results: tally(pairEntries) }],
    }
  }
  const registrations = await db
    .select({
      competitorId: competitors.id,
      bibNumber: competitors.bibNumber,
      role: divisionRegistrations.role,
    })
    .from(divisionRegistrations)
    .innerJoin(
      competitors,
      eq(competitors.id, divisionRegistrations.competitorId),
    )
    .where(eq(divisionRegistrations.divisionId, division.id))
  const groups = (['lead', 'follow'] as const)
    .map((role) => ({
      role,
      results: tally(registrations.filter((row) => row.role === role)),
    }))
    .filter((group) => group.results.length)
  return { advanceCount: division.advanceCount, groups }
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
          advancement: await advancementGroups(
            request.params.eventId,
            division,
          ),
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
        advancement: await advancementGroups(request.params.eventId, division),
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
      const isStrictly = division.type === 'strictly'
      const scope: Scope = isStrictly
        ? 'lead'
        : isScope(scopeInput)
          ? scopeInput
          : 'both'
      const rawScores = Array.isArray(body.scores) ? body.scores : null
      if (
        !Number.isInteger(expectedRevision) ||
        Number(expectedRevision) < 0 ||
        !rawScores ||
        (!isStrictly && !isScope(scopeInput))
      ) {
        return reply.code(400).send({ message: 'Scores and expected revision are required' })
      }

      let scopedIds: Set<string>
      if (isStrictly) {
        const pairRows = await db
          .select({ leadCompetitorId: divisionPairs.leadCompetitorId })
          .from(divisionPairs)
          .where(eq(divisionPairs.divisionId, request.params.divisionId))
        if (!pairRows.length) {
          return reply.code(400).send({ message: 'Division pairs must be configured before scoring' })
        }
        scopedIds = new Set(pairRows.map((row) => row.leadCompetitorId))
      } else {
        const registrations = await db
          .select({
            competitorId: divisionRegistrations.competitorId,
            role: divisionRegistrations.role,
          })
          .from(divisionRegistrations)
          .where(eq(divisionRegistrations.divisionId, request.params.divisionId))
        scopedIds = new Set(
          registrations
            .filter(
              (registration) => scope === 'both' || registration.role === scope,
            )
            .map((row) => row.competitorId),
        )
      }
      const coverageMessage = isStrictly
        ? 'A score is required for every pair using the lead competitor id'
        : 'A score is required for every competitor in the selected scope'

      const submittedScores = rawScores.map((item) => {
        if (!isRecord(item)) return null
        const competitorId =
          typeof item.competitorId === 'string' ? item.competitorId : null
        const score = item.score
        return competitorId &&
          typeof score === 'number' &&
          score >= 1 &&
          score <= 10 &&
          score * 2 === Math.round(score * 2)
          ? { competitorId, score }
          : null
      })
      if (
        submittedScores.some((item) => !item) ||
        new Set(submittedScores.map((item) => item?.competitorId)).size !==
          submittedScores.length
      ) {
        return reply.code(400).send({ message: 'Every score must be unique and in 0.5 steps from 1 to 10' })
      }
      const validScores = submittedScores as Array<{
        competitorId: string
        score: number
      }>
      if (
        validScores.length !== scopedIds.size ||
        validScores.some((item) => !scopedIds.has(item.competitorId))
      ) {
        return reply.code(400).send({ message: coverageMessage })
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
          isHead: judgeEventAssignments.isHeadJudge,
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
      const lockedJudgeIds = new Set(
        submissions
          .filter((submission) => submission.status === 'locked')
          .map((submission) => submission.judgeId),
      )
      const isAdvancement = Boolean(
        division.advanceCount && division.advanceCount > 0,
      )
      const ballots = [...lockedJudgeIds].map((judgeId) => ({
        judgeId,
        scores: Object.fromEntries(
          lockedScoreRows
            .filter((row) => row.judgeId === judgeId)
            .map((row) => [row.competitorId, row.score]),
        ),
      }))
      const assignedBallots = new Map(
        ballots
          .filter((ballot) => assignedJudgeIds.has(ballot.judgeId))
          .map((ballot) => [
            ballot.judgeId,
            new Map(Object.entries(ballot.scores)),
          ]),
      )
      const headJudgeId = assignedJudges.find((judge) => judge.isHead)?.id

      // Relative placement per scope group: each judge's scores are converted
      // to ranks (1 + entries scored strictly higher), then RPSS runs with the
      // head judge's ranks as the final tiebreak.
      function placementsFor(competitorIds: string[]) {
        const scoredBallots = ballots.filter((ballot) =>
          competitorIds.some((id) => ballot.scores[id] !== undefined),
        )
        if (!competitorIds.length || !scoredBallots.length) {
          return new Map<string, number>()
        }
        const rankFor = (
          scoresMap: Record<string, number>,
          competitorId: string,
        ) => {
          const mine = scoresMap[competitorId]
          if (mine === undefined) return undefined
          return (
            1 +
            competitorIds.filter(
              (other) =>
                (scoresMap[other] ?? Number.NEGATIVE_INFINITY) > mine,
            ).length
          )
        }
        const headScores = headJudgeId
          ? ballots.find((ballot) => ballot.judgeId === headJudgeId)?.scores
          : undefined
        const headRanks = headScores
          ? new Map(
              competitorIds.flatMap((competitorId) => {
                const rank = rankFor(headScores, competitorId)
                return rank === undefined ? [] : [[competitorId, rank] as const]
              }),
            )
          : undefined
        return new Map(
          computeRelativePlacement(
            competitorIds.map((competitorId) => ({
              competitorId,
              ranks: scoredBallots
                .map((ballot) => rankFor(ballot.scores, competitorId))
                .filter((rank): rank is number => rank !== undefined),
            })),
            competitorIds.length,
            scoredBallots.length,
            headRanks,
          ).map((row) => [row.competitorId, row.placement]),
        )
      }

      const leadPlacements = placementsFor(
        registrationRows
          .filter((row) => row.role === 'lead')
          .map((row) => row.competitorId),
      )
      const followPlacements = placementsFor(
        registrationRows
          .filter((row) => row.role === 'follow')
          .map((row) => row.competitorId),
      )

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

      const advancementFor = (competitorIds: string[]) =>
        isAdvancement
          ? advancementYesCounts(
              competitorIds,
              assignedBallots,
              division.advanceCount!,
            )
          : { points: new Map<string, number>(), advancing: new Set<string>() }

      const sortResults = (role: 'lead' | 'follow') => {
        const adv = advancementFor(
          resultRows
            .filter((row) => row.role === role)
            .map((row) => row.competitorId),
        )
        return resultRows
          .filter((row) => row.role === role)
          .map((row) => ({
            ...row,
            placement:
              (role === 'lead' ? leadPlacements : followPlacements).get(
                row.competitorId,
              ) ?? null,
            points: adv.points.get(row.competitorId) ?? 0,
            advancing: adv.advancing.has(row.competitorId),
          }))
          .sort((left, right) =>
            isAdvancement
              ? right.points - left.points ||
                right.average - left.average ||
                left.bibNumber - right.bibNumber
              : right.average - left.average ||
                left.bibNumber - right.bibNumber,
          )
      }

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

        const pairPlacements = placementsFor(
          pairRows.map((pair) => pair.leadCompetitorId),
        )
        const pairAdvancement = advancementFor(
          pairRows.map((pair) => pair.leadCompetitorId),
        )
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
              points: pairAdvancement.points.get(pair.leadCompetitorId) ?? 0,
              advancing: pairAdvancement.advancing.has(pair.leadCompetitorId),
              placement: pairPlacements.get(pair.leadCompetitorId) ?? null,
            }
          })
          .filter((row) => row !== null)
          .sort((left, right) =>
            isAdvancement
              ? right.points - left.points ||
                right.average - left.average ||
                left.leadBibNumber - right.leadBibNumber
              : right.average - left.average ||
                left.leadBibNumber - right.leadBibNumber,
          )

        return {
          event,
          division,
          judges: {
            submitted: judgeStatuses.filter((judge) => judge.status === 'locked'),
            pending: judgeStatuses.filter((judge) => judge.status !== 'locked'),
          },
          ballots,
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
        ballots,
        preliminaryResults: {
          leads: sortResults('lead'),
          follows: sortResults('follow'),
          pairs: [],
        },
      }
    },
  )
}
