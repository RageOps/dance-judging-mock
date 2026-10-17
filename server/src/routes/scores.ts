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
  scoreVotes,
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

type Vote = 'yes' | 'alternate' | 'no'
const votePoints = (vote: Vote) =>
  vote === 'yes' ? 1 : vote === 'alternate' ? 0.5 : 0

async function lockedVoteBallots(eventId: string, divisionId: string) {
  const [assigned, voteRows] = await Promise.all([
    db
      .select({
        judgeId: judgeEventAssignments.judgeId,
        isHead: judgeEventAssignments.isHeadJudge,
      })
      .from(judgeEventAssignments)
      .where(eq(judgeEventAssignments.eventId, eventId)),
    db
      .select({
        judgeId: scoreVotes.judgeId,
        competitorId: scoreVotes.competitorId,
        vote: scoreVotes.vote,
        altRank: scoreVotes.altRank,
      })
      .from(scoreVotes)
      .innerJoin(
        scoreSubmissions,
        and(
          eq(scoreSubmissions.judgeId, scoreVotes.judgeId),
          eq(scoreSubmissions.divisionId, scoreVotes.divisionId),
        ),
      )
      .where(
        and(
          eq(scoreVotes.divisionId, divisionId),
          eq(scoreSubmissions.status, 'locked'),
        ),
      ),
  ])
  const assignedJudgeIds = new Set(assigned.map((row) => row.judgeId))
  const headJudgeId = assigned.find((row) => row.isHead)?.judgeId
  const ballots = new Map<
    string,
    Map<string, { vote: Vote; altRank: number | null }>
  >()
  for (const row of voteRows) {
    if (!assignedJudgeIds.has(row.judgeId)) continue
    const ballot = ballots.get(row.judgeId) ?? new Map()
    ballot.set(row.competitorId, {
      vote: row.vote as Vote,
      altRank: row.altRank,
    })
    ballots.set(row.judgeId, ballot)
  }
  return { ballots, headJudgeId }
}

function advancementTally(
  entries: Array<{ competitorId: string; bibNumber: number }>,
  ballots: Map<string, Map<string, { vote: Vote; altRank: number | null }>>,
  advanceCount: number,
  headJudgeId?: string,
) {
  const tally = entries.map((entry) => {
    let points = 0
    let yes = 0
    for (const ballot of ballots.values()) {
      const mark = ballot.get(entry.competitorId)
      if (!mark) continue
      points += votePoints(mark.vote)
      if (mark.vote === 'yes') yes++
    }
    const headMark = headJudgeId
      ? ballots.get(headJudgeId)?.get(entry.competitorId)
      : undefined
    return {
      competitorId: entry.competitorId,
      bibNumber: entry.bibNumber,
      points,
      yes,
      headPoints: headMark ? votePoints(headMark.vote) : 0,
    }
  })
  tally.sort(
    (left, right) =>
      right.points - left.points ||
      right.yes - left.yes ||
      right.headPoints - left.headPoints ||
      left.bibNumber - right.bibNumber,
  )
  const cutoffPoints = tally.length
    ? tally[Math.min(advanceCount, tally.length) - 1]!.points
    : Number.POSITIVE_INFINITY
  return tally.map((row) => ({
    competitorId: row.competitorId,
    points: row.points,
    advancing: row.points >= cutoffPoints,
  }))
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
  const { ballots, headJudgeId } = await lockedVoteBallots(
    eventId,
    division.id,
  )
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
      groups: [
        {
          role: 'pair' as const,
          results: advancementTally(
            pairEntries,
            ballots,
            division.advanceCount,
            headJudgeId,
          ),
        },
      ],
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
      results: advancementTally(
        registrations.filter((row) => row.role === role),
        ballots,
        division.advanceCount!,
        headJudgeId,
      ),
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
            mark: scoreVotes.vote,
            altRank: scoreVotes.altRank,
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
          .leftJoin(
            scoreVotes,
            and(
              eq(scoreVotes.judgeId, request.user.id),
              eq(scoreVotes.divisionId, request.params.divisionId),
              eq(scoreVotes.competitorId, divisionPairs.leadCompetitorId),
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
            mark: pair.mark,
            altRank: pair.altRank,
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
          mark: scoreVotes.vote,
          altRank: scoreVotes.altRank,
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
        .leftJoin(
          scoreVotes,
          and(
            eq(scoreVotes.judgeId, request.user.id),
            eq(scoreVotes.divisionId, request.params.divisionId),
            eq(scoreVotes.competitorId, competitors.id),
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
      const useVotes = Boolean(division.advanceCount && division.advanceCount > 0)
      const rawScores = Array.isArray(body.scores) ? body.scores : null
      const rawVotes = Array.isArray(body.votes) ? body.votes : null
      if (
        !Number.isInteger(expectedRevision) ||
        Number(expectedRevision) < 0 ||
        (useVotes ? !rawVotes : !rawScores) ||
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
        ? 'An entry is required for every pair using the lead competitor id'
        : 'An entry is required for every competitor in the selected scope'

      let validScores: Array<{ competitorId: string; score: number }> = []
      let validVotes: Array<{ competitorId: string; vote: Vote }> = []
      if (useVotes) {
        const submittedVotes = (rawVotes ?? []).map((item) => {
          if (!isRecord(item)) return null
          const competitorId =
            typeof item.competitorId === 'string' ? item.competitorId : null
          const vote =
            item.vote === 'yes' ||
            item.vote === 'alternate' ||
            item.vote === 'no'
              ? (item.vote as Vote)
              : null
          return competitorId && vote ? { competitorId, vote } : null
        })
        if (
          submittedVotes.some((item) => !item) ||
          new Set(submittedVotes.map((item) => item?.competitorId)).size !==
            submittedVotes.length
        ) {
          return reply.code(400).send({ message: 'Every vote must be yes, alt, or no' })
        }
        validVotes = submittedVotes as Array<{
          competitorId: string
          vote: Vote
        }>
      } else {
        const submittedScores = (rawScores ?? []).map((item) => {
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
        validScores = submittedScores as Array<{
          competitorId: string
          score: number
        }>
      }

      const validEntries = useVotes ? validVotes : validScores
      if (
        validEntries.length !== scopedIds.size ||
        validEntries.some((item) => !scopedIds.has(item.competitorId))
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
        await tx
          .delete(scoreVotes)
          .where(
            and(
              eq(scoreVotes.judgeId, request.user.id),
              eq(scoreVotes.divisionId, request.params.divisionId),
            ),
          )
        if (useVotes && validVotes.length) {
          await tx.insert(scoreVotes).values(
            validVotes.map((item) => ({
              judgeId: request.user.id,
              divisionId: request.params.divisionId,
              competitorId: item.competitorId,
              vote: item.vote,
              updatedAt: now,
            })),
          )
        } else if (validScores.length) {
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

  app.put<{ Params: { eventId: string; divisionId: string } }>(
    '/api/judge/events/:eventId/divisions/:divisionId/scores/alternates',
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
      if (!division.advanceCount || division.advanceCount < 1) {
        return reply
          .code(400)
          .send({ message: 'This division does not use advancement' })
      }
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
      if (!submission || submission.status !== 'locked') {
        return reply
          .code(409)
          .send({ message: 'Submit your marks before choosing alternates' })
      }

      const body = isRecord(request.body) ? request.body : {}
      const rawAlternates = Array.isArray(body.alternates)
        ? body.alternates
        : null
      if (!rawAlternates) {
        return reply.code(400).send({ message: 'Alternates are required' })
      }
      const parsedAlternates = rawAlternates.map((item) => {
        if (!isRecord(item)) return null
        const competitorId =
          typeof item.competitorId === 'string' ? item.competitorId : null
        const rank =
          typeof item.rank === 'number' && (item.rank === 1 || item.rank === 2)
            ? item.rank
            : null
        return competitorId && rank ? { competitorId, rank } : null
      })
      if (parsedAlternates.some((item) => !item)) {
        return reply
          .code(400)
          .send({ message: 'Each alternate needs a competitor and rank 1 or 2' })
      }
      const alternates = parsedAlternates as Array<{
        competitorId: string
        rank: number
      }>
      if (
        new Set(alternates.map((item) => item.competitorId)).size !==
        alternates.length
      ) {
        return reply.code(400).send({ message: 'Alternates must be unique' })
      }

      let roleByCompetitor: Map<string, string>
      if (division.type === 'strictly') {
        const pairRows = await db
          .select({ leadCompetitorId: divisionPairs.leadCompetitorId })
          .from(divisionPairs)
          .where(eq(divisionPairs.divisionId, request.params.divisionId))
        roleByCompetitor = new Map(
          pairRows.map((row) => [row.leadCompetitorId, 'pair']),
        )
      } else {
        const scope: Scope = submission.scope ?? 'both'
        const registrations = await db
          .select({
            competitorId: divisionRegistrations.competitorId,
            role: divisionRegistrations.role,
          })
          .from(divisionRegistrations)
          .where(eq(divisionRegistrations.divisionId, request.params.divisionId))
        roleByCompetitor = new Map(
          registrations
            .filter(
              (registration) => scope === 'both' || registration.role === scope,
            )
            .map((row) => [row.competitorId, row.role]),
        )
      }

      const rankByRole = new Map<string, Set<number>>()
      for (const alternate of alternates) {
        const role = roleByCompetitor.get(alternate.competitorId)
        if (!role) {
          return reply.code(400).send({
            message: 'Alternates must be competitors you marked',
          })
        }
        const used = rankByRole.get(role) ?? new Set<number>()
        if (used.has(alternate.rank)) {
          return reply.code(400).send({
            message: 'Each alternate rank can only be used once per group',
          })
        }
        used.add(alternate.rank)
        rankByRole.set(role, used)
      }

      await db.transaction(async (tx) => {
        await tx
          .update(scoreVotes)
          .set({ altRank: null })
          .where(
            and(
              eq(scoreVotes.judgeId, request.user.id),
              eq(scoreVotes.divisionId, request.params.divisionId),
            ),
          )
        for (const alternate of alternates) {
          await tx
            .update(scoreVotes)
            .set({ altRank: alternate.rank })
            .where(
              and(
                eq(scoreVotes.judgeId, request.user.id),
                eq(scoreVotes.divisionId, request.params.divisionId),
                eq(scoreVotes.competitorId, alternate.competitorId),
              ),
            )
        }
      })
      return reply.code(204).send()
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
      const { ballots: advancementBallots } = isAdvancement
        ? await lockedVoteBallots(
            request.params.eventId,
            request.params.divisionId,
          )
        : {
            ballots: new Map<
              string,
              Map<string, { vote: Vote; altRank: number | null }>
            >(),
          }
      const voteBallots = isAdvancement
        ? [...lockedJudgeIds].map((judgeId) => {
            const marks =
              advancementBallots.get(judgeId) ??
              new Map<string, { vote: Vote; altRank: number | null }>()
            return {
              judgeId,
              votes: Object.fromEntries(
                [...marks].map(([id, mark]) => [id, mark.vote]),
              ),
              altRanks: Object.fromEntries(
                [...marks]
                  .filter(([, mark]) => mark.altRank !== null)
                  .map(([id, mark]) => [id, mark.altRank]),
              ),
            }
          })
        : []
      const ballots = isAdvancement
        ? voteBallots.map((ballot) => ({
            judgeId: ballot.judgeId,
            scores: Object.fromEntries(
              Object.entries(ballot.votes).map(([id, vote]) => [
                id,
                votePoints(vote),
              ]),
            ),
          }))
        : [...lockedJudgeIds].map((judgeId) => ({
            judgeId,
            scores: Object.fromEntries(
              lockedScoreRows
                .filter((row) => row.judgeId === judgeId)
                .map((row) => [row.competitorId, row.score]),
            ),
          }))
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
          if (isAdvancement) {
            const marks = [...advancementBallots.values()]
              .map((ballot) => ballot.get(competitor.competitorId))
              .filter((mark) => mark !== undefined)
            if (!marks.length) return null
            const points = marks.reduce(
              (sum, mark) => sum + votePoints(mark.vote),
              0,
            )
            return {
              ...competitor,
              firstName: showNames ? competitor.firstName : undefined,
              lastName: showNames ? competitor.lastName : undefined,
              submittedScoreCount: marks.length,
              average: points,
              points,
            }
          }
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

      const markAdvancing = <T extends { average: number }>(rows: T[]) => {
        const advanceCount = division.advanceCount
        if (!advanceCount || advanceCount < 1 || !rows.length) {
          return rows.map((row) => ({ ...row, advancing: false }))
        }
        const cutoff = rows[Math.min(advanceCount, rows.length) - 1]!.average
        return rows.map((row) => ({
          ...row,
          advancing: row.average >= cutoff,
        }))
      }

      const sortResults = (role: 'lead' | 'follow') =>
        resultRows
          .filter((row) => row.role === role)
          .map((row) => ({
            ...row,
            placement:
              (role === 'lead' ? leadPlacements : followPlacements).get(
                row.competitorId,
              ) ?? null,
          }))
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

        const pairPlacements = placementsFor(
          pairRows.map((pair) => pair.leadCompetitorId),
        )
        const pairResults = pairRows
          .map((pair) => {
            if (isAdvancement) {
              const marks = [...advancementBallots.values()]
                .map((ballot) => ballot.get(pair.leadCompetitorId))
                .filter((mark) => mark !== undefined)
              if (!marks.length) return null
              const points = marks.reduce(
                (sum, mark) => sum + votePoints(mark.vote),
                0,
              )
              return {
                leadCompetitorId: pair.leadCompetitorId,
                leadBibNumber: pair.leadBibNumber,
                leadFirstName: showNames ? pair.leadFirstName : undefined,
                followFirstName: showNames ? pair.followFirstName : undefined,
                submittedScoreCount: marks.length,
                average: points,
                points,
                placement: pairPlacements.get(pair.leadCompetitorId) ?? null,
              }
            }
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
              placement: pairPlacements.get(pair.leadCompetitorId) ?? null,
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
          ballots,
          voteBallots,
          preliminaryResults: {
            leads: [],
            follows: [],
            pairs: markAdvancing(pairResults),
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
        voteBallots,
        preliminaryResults: {
          leads: markAdvancing(sortResults('lead')),
          follows: markAdvancing(sortResults('follow')),
          pairs: [],
        },
      }
    },
  )
}
