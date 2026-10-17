import { and, asc, eq, inArray, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import type { FastifyInstance } from 'fastify'
import { db } from '../db/client.js'
import {
  callbackVotes,
  competitors,
  divisionPairs,
  divisionRegistrations,
  divisionRounds,
  divisions,
  events,
  heatEntries,
  heats,
  judgeEventAssignments,
  placements,
  roundImpressions,
  roundSubmissions,
  users,
} from '../db/schema.js'
import {
  requireAuth,
  requireEventAccess,
  requireEventManagerAccess,
} from '../middleware/auth.js'
import { computeRelativePlacement } from '../relativePlacement.js'

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null
const nonEmptyString = (value: unknown) =>
  typeof value === 'string' && value.trim() ? value.trim() : null
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

async function validateRound(divisionId: string, roundId: string) {
  const [round] = await db
    .select()
    .from(divisionRounds)
    .where(
      and(
        eq(divisionRounds.id, roundId),
        eq(divisionRounds.divisionId, divisionId),
      ),
    )
    .limit(1)
  return round
}

type HeatEntryRow = {
  heatId: string
  heatPosition: number
  competitorId: string
  bibNumber: number
  firstName: string | undefined
  lastName: string | undefined
  role?: 'lead' | 'follow' | null
  followCompetitorId?: string | null
  followBibNumber?: number | null
  followFirstName?: string | null
  followLastName?: string | null
}

async function loadRoundEntries(
  roundId: string,
  division: { id: string; type: 'jack_and_jill' | 'strictly' },
): Promise<HeatEntryRow[]> {
  if (division.type === 'strictly') {
    const followCompetitor = alias(competitors, 'follow_competitor')
    return db
      .select({
        heatId: heats.id,
        heatPosition: heats.position,
        competitorId: heatEntries.competitorId,
        bibNumber: competitors.bibNumber,
        firstName: competitors.firstName,
        lastName: competitors.lastName,
        followCompetitorId: divisionPairs.followCompetitorId,
        followBibNumber: followCompetitor.bibNumber,
        followFirstName: followCompetitor.firstName,
        followLastName: followCompetitor.lastName,
      })
      .from(heatEntries)
      .innerJoin(heats, eq(heats.id, heatEntries.heatId))
      .innerJoin(competitors, eq(competitors.id, heatEntries.competitorId))
      .leftJoin(
        divisionPairs,
        and(
          eq(divisionPairs.divisionId, division.id),
          eq(divisionPairs.leadCompetitorId, heatEntries.competitorId),
        ),
      )
      .leftJoin(
        followCompetitor,
        eq(followCompetitor.id, divisionPairs.followCompetitorId),
      )
      .where(eq(heats.roundId, roundId))
      .orderBy(asc(heats.position), asc(competitors.bibNumber))
  }
  const followCompetitor = alias(competitors, 'follow_competitor')
  return db
    .select({
      heatId: heats.id,
      heatPosition: heats.position,
      competitorId: heatEntries.competitorId,
      bibNumber: competitors.bibNumber,
      firstName: competitors.firstName,
      lastName: competitors.lastName,
      role: divisionRegistrations.role,
      followCompetitorId: heatEntries.followCompetitorId,
      followBibNumber: followCompetitor.bibNumber,
      followFirstName: followCompetitor.firstName,
      followLastName: followCompetitor.lastName,
    })
    .from(heatEntries)
    .innerJoin(heats, eq(heats.id, heatEntries.heatId))
    .innerJoin(competitors, eq(competitors.id, heatEntries.competitorId))
    .innerJoin(
      divisionRegistrations,
      and(
        eq(divisionRegistrations.competitorId, heatEntries.competitorId),
        eq(divisionRegistrations.divisionId, division.id),
      ),
    )
    .leftJoin(
      followCompetitor,
      eq(followCompetitor.id, heatEntries.followCompetitorId),
    )
    .where(eq(heats.roundId, roundId))
    .orderBy(asc(heats.position), asc(competitors.bibNumber))
}

function groupEntriesIntoHeats(rows: HeatEntryRow[]) {
  const byHeat = new Map<string, { id: string; position: number; entries: HeatEntryRow[] }>()
  for (const row of rows) {
    const heat = byHeat.get(row.heatId) ?? {
      id: row.heatId,
      position: row.heatPosition,
      entries: [],
    }
    heat.entries.push(row)
    byHeat.set(row.heatId, heat)
  }
  return [...byHeat.values()].sort((a, b) => a.position - b.position)
}

export async function roundRoutes(app: FastifyInstance) {
  app.get<{ Params: { eventId: string; divisionId: string } }>(
    '/api/events/:eventId/divisions/:divisionId/rounds',
    { preHandler: requireAuth },
    async (request, reply) => {
      if (!(await requireEventAccess(request, reply, request.params.eventId))) return
      const division = await validateDivision(
        request.params.eventId,
        request.params.divisionId,
      )
      if (!division) return reply.code(404).send({ message: 'Division not found' })

      const roundRows = await db
        .select()
        .from(divisionRounds)
        .where(eq(divisionRounds.divisionId, request.params.divisionId))
        .orderBy(asc(divisionRounds.position))

      const showNames =
        request.user.role !== 'judge' || division.showCompetitorNames
      const result = []
      for (const round of roundRows) {
        const rows = (await loadRoundEntries(round.id, division)).map(
          (row) => ({
            ...row,
            firstName: showNames ? row.firstName : undefined,
            lastName: showNames ? row.lastName : undefined,
            followFirstName: showNames ? row.followFirstName : undefined,
            followLastName: showNames ? row.followLastName : undefined,
          }),
        )
        const submissions = await db
          .select()
          .from(roundSubmissions)
          .where(eq(roundSubmissions.roundId, round.id))
        const mine =
          request.user.role === 'judge'
            ? submissions.find(
                (submission) => submission.judgeId === request.user.id,
              )
            : undefined
        result.push({
          ...round,
          heats: groupEntriesIntoHeats(rows),
          lockedSubmissions: submissions.filter((s) => s.status === 'locked')
            .length,
          totalSubmissions: submissions.length,
          myStatus: mine?.status ?? 'not_started',
          myRevision: mine?.revision ?? 0,
        })
      }
      return result
    },
  )

  app.post<{ Params: { eventId: string; divisionId: string } }>(
    '/api/events/:eventId/divisions/:divisionId/rounds',
    { preHandler: requireAuth },
    async (request, reply) => {
      if (!(await requireEventManagerAccess(request, reply, request.params.eventId))) return
      const division = await validateDivision(
        request.params.eventId,
        request.params.divisionId,
      )
      if (!division) return reply.code(404).send({ message: 'Division not found' })

      const body = isRecord(request.body) ? request.body : {}
      const name = nonEmptyString(body.name)
      const type =
        body.type === 'callback' || body.type === 'relative_placement'
          ? body.type
          : null
      const advanceCount =
        body.advanceCount === undefined ||
        body.advanceCount === null ||
        body.advanceCount === 0
          ? null
          : typeof body.advanceCount === 'number' &&
              Number.isInteger(body.advanceCount) &&
              body.advanceCount >= 1
            ? body.advanceCount
            : undefined
      if (!name || !type || advanceCount === undefined) {
        return reply
          .code(400)
          .send({ message: 'A round name and valid type are required' })
      }

      const existing = await db
        .select({ position: divisionRounds.position })
        .from(divisionRounds)
        .where(eq(divisionRounds.divisionId, request.params.divisionId))
      const position = existing.length
        ? Math.max(...existing.map((row) => row.position)) + 1
        : 1
      const [created] = await db
        .insert(divisionRounds)
        .values({
          divisionId: request.params.divisionId,
          name,
          type,
          advanceCount,
          position,
        })
        .returning()
      return reply.code(201).send(created)
    },
  )

  app.patch<{
    Params: { eventId: string; divisionId: string; roundId: string }
  }>(
    '/api/events/:eventId/divisions/:divisionId/rounds/:roundId',
    { preHandler: requireAuth },
    async (request, reply) => {
      if (!(await requireEventManagerAccess(request, reply, request.params.eventId))) return
      const round = await validateRound(
        request.params.divisionId,
        request.params.roundId,
      )
      if (!round) return reply.code(404).send({ message: 'Round not found' })

      const body = isRecord(request.body) ? request.body : {}
      const name =
        body.name === undefined ? undefined : nonEmptyString(body.name)
      const status =
        body.status === undefined
          ? undefined
          : body.status === 'pending' ||
              body.status === 'active' ||
              body.status === 'complete'
            ? body.status
            : null
      const advanceCount =
        body.advanceCount === undefined
          ? undefined
          : body.advanceCount === null ||
              body.advanceCount === 0 ||
              (typeof body.advanceCount === 'number' &&
                Number.isInteger(body.advanceCount) &&
                body.advanceCount >= 1)
            ? body.advanceCount || null
            : -1
      if (name === null || status === null || advanceCount === -1) {
        return reply.code(400).send({ message: 'Invalid round update' })
      }
      const [updated] = await db
        .update(divisionRounds)
        .set({
          ...(name === undefined ? {} : { name }),
          ...(status === undefined ? {} : { status }),
          ...(advanceCount === undefined ? {} : { advanceCount }),
        })
        .where(eq(divisionRounds.id, request.params.roundId))
        .returning()
      return updated
    },
  )

  app.delete<{
    Params: { eventId: string; divisionId: string; roundId: string }
  }>(
    '/api/events/:eventId/divisions/:divisionId/rounds/:roundId',
    { preHandler: requireAuth },
    async (request, reply) => {
      if (!(await requireEventManagerAccess(request, reply, request.params.eventId))) return
      const [deleted] = await db
        .delete(divisionRounds)
        .where(
          and(
            eq(divisionRounds.id, request.params.roundId),
            eq(divisionRounds.divisionId, request.params.divisionId),
          ),
        )
        .returning()
      if (!deleted) return reply.code(404).send({ message: 'Round not found' })
      return reply.code(204).send()
    },
  )

  app.put<{
    Params: { eventId: string; divisionId: string; roundId: string }
  }>(
    '/api/events/:eventId/divisions/:divisionId/rounds/:roundId/heats',
    { preHandler: requireAuth },
    async (request, reply) => {
      if (!(await requireEventManagerAccess(request, reply, request.params.eventId))) return
      const division = await validateDivision(
        request.params.eventId,
        request.params.divisionId,
      )
      if (!division) return reply.code(404).send({ message: 'Division not found' })
      const round = await validateRound(
        request.params.divisionId,
        request.params.roundId,
      )
      if (!round) return reply.code(404).send({ message: 'Round not found' })
      if (round.status === 'complete') {
        return reply
          .code(409)
          .send({ message: 'A completed round cannot be changed' })
      }

      const body = isRecord(request.body) ? request.body : {}
      const rawHeats = Array.isArray(body.heats) ? body.heats : null
      if (!rawHeats) {
        return reply.code(400).send({ message: 'Heats are required' })
      }
      // Each heat accepts either `competitorIds` (plain id strings) or
      // `entries` ({ competitorId, followCompetitorId? } objects). The latter
      // is how Jack & Jill finals pairs are submitted.
      const parsed = rawHeats.map((heat) => {
        if (!isRecord(heat)) return null
        const rawEntries = Array.isArray(heat.entries)
          ? heat.entries
          : Array.isArray(heat.competitorIds)
            ? heat.competitorIds
            : null
        if (!rawEntries) return null
        const entries = rawEntries.map((item) => {
          if (typeof item === 'string') {
            return { competitorId: item, followCompetitorId: null }
          }
          if (!isRecord(item)) return null
          const competitorId =
            typeof item.competitorId === 'string' ? item.competitorId : null
          const followCompetitorId =
            typeof item.followCompetitorId === 'string'
              ? item.followCompetitorId
              : null
          return competitorId ? { competitorId, followCompetitorId } : null
        })
        return entries.every((entry) => entry !== null) ? entries : null
      })
      if (parsed.some((heat) => !heat)) {
        return reply
          .code(400)
          .send({ message: 'Each heat needs a list of competitor entries' })
      }
      const heatLists = parsed as Array<
        Array<{ competitorId: string; followCompetitorId: string | null }>
      >
      const allIds = heatLists.flat().map((entry) => entry.competitorId)
      const allFollows = heatLists
        .flat()
        .map((entry) => entry.followCompetitorId)
        .filter((id): id is string => id !== null)
      const jnjFinal =
        division.type === 'jack_and_jill' &&
        round.type === 'relative_placement'
      if (
        new Set(allIds).size !== allIds.length ||
        new Set(allFollows).size !== allFollows.length ||
        // In a J&J final a follow appears as their own promoted entry AND as
        // a lead's partner, so follows may overlap allIds there — elsewhere
        // they must stay distinct.
        (!jnjFinal && allFollows.some((id) => allIds.includes(id))) ||
        heatLists.flat().some((entry) => entry.competitorId === entry.followCompetitorId)
      ) {
        return reply
          .code(400)
          .send({
            message:
              'A competitor can only appear once, and pair partners must be distinct',
          })
      }
      if (round.type === 'relative_placement' && heatLists.length > 1) {
        return reply
          .code(400)
          .send({ message: 'Finals are scored in a single heat' })
      }

      // Entries must be registered (Jack & Jill) or paired leads (Strictly).
      const registrations = await db
        .select({
          competitorId: divisionRegistrations.competitorId,
          role: divisionRegistrations.role,
        })
        .from(divisionRegistrations)
        .where(
          eq(divisionRegistrations.divisionId, request.params.divisionId),
        )
      const eligible =
        division.type === 'strictly'
          ? new Set(
              (
                await db
                  .select({ id: divisionPairs.leadCompetitorId })
                  .from(divisionPairs)
                  .where(
                    eq(divisionPairs.divisionId, request.params.divisionId),
                  )
              ).map((row) => row.id),
            )
          : new Set(registrations.map((row) => row.competitorId))
      if (allIds.some((id) => !eligible.has(id))) {
        return reply
          .code(400)
          .send({ message: 'Heat entries must be division participants' })
      }
      if (division.type === 'jack_and_jill') {
        const roleById = new Map(
          registrations.map((row) => [row.competitorId, row.role]),
        )
        const allIdSet = new Set(allIds)
        const entries = heatLists.flat()
        if (
          allFollows.some((id) => !eligible.has(id)) ||
          (jnjFinal &&
            entries.some(
              (entry) =>
                // A partner may only come from a promoted (in-round) follow,
                // and only lead entries can carry a partner.
                (entry.followCompetitorId !== null &&
                  (roleById.get(entry.competitorId) !== 'lead' ||
                    roleById.get(entry.followCompetitorId) !== 'follow' ||
                    !allIdSet.has(entry.followCompetitorId))),
            ))
        ) {
          return reply.code(400).send({
            message: jnjFinal
              ? 'Finals pairs must be a lead with a promoted in-round follow'
              : 'Pair partners must be division participants',
          })
        }
      }

      await db.transaction(async (tx) => {
        await tx
          .delete(heats)
          .where(eq(heats.roundId, request.params.roundId))
        for (const [index, entries] of heatLists.entries()) {
          const [heat] = await tx
            .insert(heats)
            .values({ roundId: request.params.roundId, position: index + 1 })
            .returning()
          if (!heat) throw new Error('Failed to create heat')
          if (entries.length) {
            await tx.insert(heatEntries).values(
              entries.map((entry) => ({
                heatId: heat.id,
                competitorId: entry.competitorId,
                followCompetitorId: entry.followCompetitorId,
              })),
            )
          }
        }
      })
      return reply.code(204).send()
    },
  )

  app.get<{
    Params: { eventId: string; divisionId: string; roundId: string }
  }>(
    '/api/events/:eventId/divisions/:divisionId/rounds/:roundId/results',
    { preHandler: requireAuth },
    async (request, reply) => {
      if (!(await requireEventAccess(request, reply, request.params.eventId))) return
      const division = await validateDivision(
        request.params.eventId,
        request.params.divisionId,
      )
      if (!division) return reply.code(404).send({ message: 'Division not found' })
      const round = await validateRound(
        request.params.divisionId,
        request.params.roundId,
      )
      if (!round) return reply.code(404).send({ message: 'Round not found' })

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
      const headJudgeId = assignedJudges.find((judge) => judge.isHead)?.id
      const submissions = await db
        .select()
        .from(roundSubmissions)
        .where(eq(roundSubmissions.roundId, request.params.roundId))
      const lockedSubmissions = submissions.filter(
        (submission) => submission.status === 'locked',
      )
      const lockedJudgeIds = new Set(
        lockedSubmissions.map((submission) => submission.judgeId),
      )
      const showNames =
        request.user.role === 'admin' ||
        request.user.role === 'coordinator' ||
        division.showCompetitorNames
      const judgeStatuses = assignedJudges.map((judge) => {
        const submission = submissions.find((item) => item.judgeId === judge.id)
        return {
          ...judge,
          status: submission?.status ?? 'not_started',
          scope: submission?.scope ?? null,
          submittedAt: submission?.submittedAt ?? null,
        }
      })
      const entryRows = (await loadRoundEntries(round.id, division)).filter(
        // In J&J finals, follow-role rows are promotion markers — only lead
        // entries (which carry their partner) are judged.
        (row) => round.type !== 'relative_placement' || row.role !== 'follow',
      )
      const mask = (row: HeatEntryRow) => ({
        ...row,
        firstName: showNames ? row.firstName : undefined,
        lastName: showNames ? row.lastName : undefined,
        followFirstName:
          row.followFirstName && showNames ? row.followFirstName : undefined,
        followLastName:
          row.followLastName && showNames ? row.followLastName : undefined,
      })

      const base = {
        event,
        division,
        round,
        judges: {
          submitted: judgeStatuses.filter((judge) => judge.status === 'locked'),
          pending: judgeStatuses.filter((judge) => judge.status !== 'locked'),
        },
      }

      if (round.type === 'callback') {
        const voteRows = lockedJudgeIds.size
          ? await db
              .select()
              .from(callbackVotes)
              .where(
                and(
                  eq(callbackVotes.roundId, round.id),
                  inArray(callbackVotes.judgeId, [...lockedJudgeIds]),
                ),
              )
          : []
        const results = entryRows.map((entry) => {
          const votes = voteRows.filter(
            (vote) => vote.competitorId === entry.competitorId,
          )
          const yes = votes.filter((vote) => vote.vote === 'yes').length
          const alternate = votes.filter(
            (vote) => vote.vote === 'alternate',
          ).length
          const no = votes.filter((vote) => vote.vote === 'no').length
          return {
            ...mask(entry),
            yes,
            alternate,
            no,
            points: yes + alternate * 0.5,
          }
        })
        const headVoteByCompetitor = new Map(
          voteRows
            .filter((vote) => vote.judgeId === headJudgeId)
            .map((vote) => [vote.competitorId, vote.vote]),
        )
        const headVoteRank = (id: string) => {
          const vote = headVoteByCompetitor.get(id)
          return vote === undefined
            ? -1
            : { yes: 2, alternate: 1, no: 0 }[vote]
        }
        const advanceCount =
          round.advanceCount && round.advanceCount >= 1
            ? round.advanceCount
            : null
        // Tally pools every entry in the round regardless of heat. Advancing
        // entries are the top N per group ranked by yes count; entries tied on
        // yeses are broken by aggregate points, then head-judge vote, then bib.
        const sortRows = (rows: typeof results) => {
          const sorted = [...rows].sort(
            (a, b) =>
              b.yes - a.yes ||
              b.points - a.points ||
              headVoteRank(b.competitorId) - headVoteRank(a.competitorId) ||
              a.bibNumber - b.bibNumber,
          )
          const advancing = new Set(
            advanceCount
              ? sorted
                  .slice(0, Math.min(advanceCount, sorted.length))
                  .map((row) => row.competitorId)
              : [],
          )
          return sorted.map((row) => ({
            ...row,
            advancing: advancing.has(row.competitorId),
          }))
        }
        return {
          ...base,
          results: {
            leads: sortRows(results.filter((row) => row.role === 'lead')),
            follows: sortRows(results.filter((row) => row.role === 'follow')),
            entries: sortRows(results.filter((row) => row.role == null)),
            voteBallots: [...lockedJudgeIds].map((judgeId) => ({
              judgeId,
              votes: Object.fromEntries(
                voteRows
                  .filter((row) => row.judgeId === judgeId)
                  .map((row) => [row.competitorId, row.vote]),
              ),
            })),
          },
        }
      }

      const placementRows = lockedJudgeIds.size
        ? await db
            .select()
            .from(placements)
            .where(
              and(
                eq(placements.roundId, round.id),
                inArray(placements.judgeId, [...lockedJudgeIds]),
              ),
            )
        : []
      const ranksByCompetitor = new Map<string, number[]>()
      for (const row of placementRows) {
        const list = ranksByCompetitor.get(row.competitorId) ?? []
        list.push(row.rank)
        ranksByCompetitor.set(row.competitorId, list)
      }
      const headRanks = new Map(
        placementRows
          .filter((row) => row.judgeId === headJudgeId)
          .map((row) => [row.competitorId, row.rank]),
      )
      const computed =
        lockedJudgeIds.size && entryRows.length
          ? computeRelativePlacement(
              entryRows.map((entry) => ({
                competitorId: entry.competitorId,
                ranks: ranksByCompetitor.get(entry.competitorId) ?? [],
              })),
              entryRows.length,
              lockedJudgeIds.size,
              headRanks,
            )
          : []
      const placementById = new Map(
        computed.map((row) => [row.competitorId, row]),
      )
      const ballots = [...lockedJudgeIds].map((judgeId) => ({
        judgeId,
        ranks: Object.fromEntries(
          placementRows
            .filter((row) => row.judgeId === judgeId)
            .map((row) => [row.competitorId, row.rank]),
        ),
      }))
      return {
        ...base,
        results: {
          placements: entryRows
            .map((entry) => ({
              ...mask(entry),
              placement: placementById.get(entry.competitorId)?.placement ?? null,
              cumulativeCounts:
                placementById.get(entry.competitorId)?.cumulativeCounts ?? [],
            }))
            .sort(
              (a, b) =>
                (a.placement ?? Number.MAX_SAFE_INTEGER) -
                  (b.placement ?? Number.MAX_SAFE_INTEGER) ||
                a.bibNumber - b.bibNumber,
            ),
          ballots,
        },
      }
    },
  )

  app.get<{
    Params: { eventId: string; divisionId: string; roundId: string }
  }>(
    '/api/judge/events/:eventId/divisions/:divisionId/rounds/:roundId/scores',
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
      const round = await validateRound(
        request.params.divisionId,
        request.params.roundId,
      )
      if (!round) return reply.code(404).send({ message: 'Round not found' })

      const [event] = await db
        .select()
        .from(events)
        .where(eq(events.id, request.params.eventId))
        .limit(1)
      const [submission] = await db
        .select()
        .from(roundSubmissions)
        .where(
          and(
            eq(roundSubmissions.judgeId, request.user.id),
            eq(roundSubmissions.roundId, request.params.roundId),
          ),
        )
        .limit(1)

      const marks =
        round.type === 'callback'
          ? await db
              .select({
                competitorId: callbackVotes.competitorId,
                vote: callbackVotes.vote,
              })
              .from(callbackVotes)
              .where(
                and(
                  eq(callbackVotes.judgeId, request.user.id),
                  eq(callbackVotes.roundId, round.id),
                ),
              )
          : await db
              .select({
                competitorId: placements.competitorId,
                rank: placements.rank,
              })
              .from(placements)
              .where(
                and(
                  eq(placements.judgeId, request.user.id),
                  eq(placements.roundId, round.id),
                ),
              )
      const markByCompetitor = new Map(
        marks.map((mark) => [
          mark.competitorId,
          'vote' in mark ? mark.vote : mark.rank,
        ]),
      )
      const impressionRows = await db
        .select({
          competitorId: roundImpressions.competitorId,
          score: roundImpressions.score,
        })
        .from(roundImpressions)
        .where(
          and(
            eq(roundImpressions.judgeId, request.user.id),
            eq(roundImpressions.roundId, round.id),
          ),
        )
      const impressionByCompetitor = new Map(
        impressionRows.map((row) => [row.competitorId, row.score]),
      )

      const rows = (await loadRoundEntries(round.id, division)).filter(
        (row) => round.type !== 'relative_placement' || row.role !== 'follow',
      )
      const heatsResult = groupEntriesIntoHeats(rows).map((heat) => ({
        id: heat.id,
        position: heat.position,
        entries: heat.entries.map((entry) => ({
          competitorId: entry.competitorId,
          bibNumber: entry.bibNumber,
          role: entry.role ?? undefined,
          firstName: division.showCompetitorNames ? entry.firstName : undefined,
          lastName: division.showCompetitorNames ? entry.lastName : undefined,
          followCompetitorId: entry.followCompetitorId ?? undefined,
          followBibNumber: entry.followBibNumber ?? undefined,
          followFirstName:
            entry.followFirstName && division.showCompetitorNames
              ? entry.followFirstName
              : undefined,
          followLastName:
            entry.followLastName && division.showCompetitorNames
              ? entry.followLastName
              : undefined,
          mark: markByCompetitor.get(entry.competitorId) ?? null,
          impression:
            impressionByCompetitor.get(entry.competitorId) ?? null,
        })),
      }))

      return {
        event,
        division,
        round,
        status: submission?.status ?? 'editing',
        scope: submission?.scope ?? (division.type === 'strictly' ? 'lead' : 'both'),
        revision: submission?.revision ?? 0,
        submittedAt: submission?.submittedAt ?? null,
        heats: heatsResult,
      }
    },
  )

  app.post<{
    Params: { eventId: string; divisionId: string; roundId: string }
  }>(
    '/api/judge/events/:eventId/divisions/:divisionId/rounds/:roundId/scores/edit',
    { preHandler: requireAuth },
    async (request, reply) => {
      if (request.user.role !== 'judge') {
        return reply.code(403).send({ message: 'Judge access required' })
      }
      if (!(await requireEventAccess(request, reply, request.params.eventId))) return
      const round = await validateRound(
        request.params.divisionId,
        request.params.roundId,
      )
      if (!round) return reply.code(404).send({ message: 'Round not found' })

      const body = isRecord(request.body) ? request.body : {}
      const expectedRevision = body.expectedRevision
      if (!Number.isInteger(expectedRevision) || Number(expectedRevision) < 1) {
        return reply.code(400).send({ message: 'Expected revision is required' })
      }
      const [updated] = await db
        .update(roundSubmissions)
        .set({ status: 'editing', updatedAt: new Date() })
        .where(
          and(
            eq(roundSubmissions.judgeId, request.user.id),
            eq(roundSubmissions.roundId, request.params.roundId),
            eq(roundSubmissions.status, 'locked'),
            eq(roundSubmissions.revision, Number(expectedRevision)),
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

  app.put<{
    Params: { eventId: string; divisionId: string; roundId: string }
  }>(
    '/api/judge/events/:eventId/divisions/:divisionId/rounds/:roundId/scores',
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
      const round = await validateRound(
        request.params.divisionId,
        request.params.roundId,
      )
      if (!round) return reply.code(404).send({ message: 'Round not found' })
      if (round.status !== 'active') {
        return reply
          .code(409)
          .send({ message: 'This round is not open for scoring' })
      }

      const body = isRecord(request.body) ? request.body : {}
      const expectedRevision = body.expectedRevision
      if (!Number.isInteger(expectedRevision) || Number(expectedRevision) < 0) {
        return reply
          .code(400)
          .send({ message: 'Marks and expected revision are required' })
      }

      const entryRows = await loadRoundEntries(round.id, division)
      const isStrictly = division.type === 'strictly'
      const scope: Scope = isStrictly
        ? 'lead'
        : isScope(body.scope)
          ? body.scope
          : 'both'
      if (
        !isStrictly &&
        round.type === 'callback' &&
        !isScope(body.scope)
      ) {
        return reply.code(400).send({ message: 'A judging scope is required' })
      }
      const scopedEntries = entryRows.filter(
        (entry) =>
          (round.type !== 'relative_placement' || entry.role !== 'follow') &&
          (isStrictly || scope === 'both' || entry.role === scope),
      )
      const scopedIds = new Set(scopedEntries.map((entry) => entry.competitorId))

      let marks: Array<{ competitorId: string; value: string | number }>
      if (round.type === 'callback') {
        const raw = Array.isArray(body.votes) ? body.votes : null
        const parsed = (raw ?? []).map((item) => {
          if (!isRecord(item)) return null
          const competitorId = nonEmptyString(item.competitorId)
          const vote =
            item.vote === 'yes' ||
            item.vote === 'alternate' ||
            item.vote === 'no'
              ? item.vote
              : null
          return competitorId && vote ? { competitorId, value: vote } : null
        })
        if (!raw || parsed.some((item) => !item)) {
          return reply
            .code(400)
            .send({ message: 'Every vote must be yes, alternate, or no' })
        }
        marks = parsed as Array<{ competitorId: string; value: string }>
        if (
          marks.length !== scopedEntries.length ||
          marks.some((mark) => !scopedIds.has(mark.competitorId))
        ) {
          return reply
            .code(400)
            .send({ message: 'A vote is required for every competitor in scope' })
        }
      } else {
        const raw = Array.isArray(body.placements) ? body.placements : null
        const parsed = (raw ?? []).map((item) => {
          if (!isRecord(item)) return null
          const competitorId = nonEmptyString(item.competitorId)
          const rank = item.rank
          return competitorId && Number.isInteger(rank) && Number(rank) >= 1
            ? { competitorId, value: Number(rank) }
            : null
        })
        if (!raw || parsed.some((item) => !item)) {
          return reply
            .code(400)
            .send({ message: 'Every finalist needs a positive integer rank' })
        }
        marks = parsed as Array<{ competitorId: string; value: number }>
        const ranks = marks
          .map((mark) => mark.value as number)
          .sort((a, b) => a - b)
        const isPermutation =
          marks.length === scopedEntries.length &&
          ranks.every((rank, index) => rank === index + 1)
        if (
          !isPermutation ||
          marks.some((mark) => !scopedIds.has(mark.competitorId))
        ) {
          return reply
            .code(400)
            .send({
              message: `Ranks must be a unique ordering from 1 to ${scopedEntries.length}`,
            })
        }
      }

      let impressionRows: Array<{ competitorId: string; score: number }> = []
      if (body.impressions !== undefined) {
        const raw = Array.isArray(body.impressions) ? body.impressions : null
        const entryIds = new Set(
          entryRows.map((entry) => entry.competitorId),
        )
        const parsed = (raw ?? []).map((item) => {
          if (!isRecord(item)) return null
          const competitorId = nonEmptyString(item.competitorId)
          const score = item.score
          return competitorId &&
            typeof score === 'number' &&
            score >= 1 &&
            score <= 10 &&
            score * 2 === Math.round(score * 2) &&
            entryIds.has(competitorId)
            ? { competitorId, score }
            : null
        })
        if (!raw || parsed.some((item) => !item)) {
          return reply.code(400).send({
            message:
              'Impressions need a round competitor and a 1–10 score in 0.5 steps',
          })
        }
        impressionRows = parsed as Array<{
          competitorId: string
          score: number
        }>
      }

      const now = new Date()
      const result = await db.transaction(async (tx) => {
        let nextRevision: number
        if (Number(expectedRevision) === 0) {
          const [created] = await tx
            .insert(roundSubmissions)
            .values({
              judgeId: request.user.id,
              roundId: request.params.roundId,
              status: 'locked',
              scope,
              revision: 1,
              submittedAt: now,
              updatedAt: now,
            })
            .onConflictDoNothing()
            .returning({ revision: roundSubmissions.revision })
          if (!created) return null
          nextRevision = created.revision
        } else {
          const [updated] = await tx
            .update(roundSubmissions)
            .set({
              status: 'locked',
              scope,
              revision: sql`${roundSubmissions.revision} + 1`,
              submittedAt: now,
              updatedAt: now,
            })
            .where(
              and(
                eq(roundSubmissions.judgeId, request.user.id),
                eq(roundSubmissions.roundId, request.params.roundId),
                eq(roundSubmissions.status, 'editing'),
                eq(roundSubmissions.revision, Number(expectedRevision)),
              ),
            )
            .returning({ revision: roundSubmissions.revision })
          if (!updated) return null
          nextRevision = updated.revision
        }

        const markTable =
          round.type === 'callback' ? callbackVotes : placements
        await tx
          .delete(markTable)
          .where(
            and(
              eq(markTable.judgeId, request.user.id),
              eq(markTable.roundId, request.params.roundId),
            ),
          )
        if (marks.length) {
          if (round.type === 'callback') {
            await tx.insert(callbackVotes).values(
              marks.map((mark) => ({
                judgeId: request.user.id,
                roundId: request.params.roundId,
                competitorId: mark.competitorId,
                vote: mark.value as 'yes' | 'alternate' | 'no',
                updatedAt: now,
              })),
            )
          } else {
            await tx.insert(placements).values(
              marks.map((mark) => ({
                judgeId: request.user.id,
                roundId: request.params.roundId,
                competitorId: mark.competitorId,
                rank: mark.value as number,
                updatedAt: now,
              })),
            )
          }
        }
        if (body.impressions !== undefined) {
          await tx
            .delete(roundImpressions)
            .where(
              and(
                eq(roundImpressions.judgeId, request.user.id),
                eq(roundImpressions.roundId, request.params.roundId),
              ),
            )
          if (impressionRows.length) {
            await tx.insert(roundImpressions).values(
              impressionRows.map((row) => ({
                judgeId: request.user.id,
                roundId: request.params.roundId,
                competitorId: row.competitorId,
                score: row.score,
                updatedAt: now,
              })),
            )
          }
        }
        return nextRevision
      })

      if (result === null) {
        return reply.code(409).send({
          message: 'Marks are locked or changed elsewhere; refresh and try again',
        })
      }
      return { status: 'locked', revision: result, submittedAt: now }
    },
  )
}
