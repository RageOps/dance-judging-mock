import {
  boolean,
  check,
  date,
  foreignKey,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'

export const userRole = pgEnum('user_role', ['admin', 'judge', 'coordinator'])
export const divisionType = pgEnum('division_type', ['jack_and_jill', 'strictly'])
export const dancerRole = pgEnum('dancer_role', ['lead', 'follow'])
export const scoreSubmissionStatus = pgEnum('score_submission_status', [
  'editing',
  'locked',
])
export const judgingScope = pgEnum('judging_scope', ['lead', 'follow', 'both'])
export const divisionScoringMode = pgEnum('division_scoring_mode', [
  'numeric',
  'rounds',
])
export const roundType = pgEnum('round_type', [
  'callback',
  'relative_placement',
])
export const roundStatus = pgEnum('round_status', [
  'pending',
  'active',
  'complete',
])
export const callbackVoteValue = pgEnum('callback_vote', [
  'yes',
  'alternate',
  'no',
])

export const events = pgTable('events', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  eventDate: date('event_date'),
  nextBibNumber: integer('next_bib_number').notNull().default(1),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  firstName: text('first_name').notNull().default(''),
  lastName: text('last_name').notNull().default(''),
  role: userRole('role').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const judgeEventAssignments = pgTable(
  'judge_event_assignments',
  {
    judgeId: uuid('judge_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    eventId: uuid('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    isHeadJudge: boolean('is_head_judge').notNull().default(false),
    assignedAt: timestamp('assigned_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.judgeId, table.eventId] })],
)

export const coordinatorEventAssignments = pgTable(
  'coordinator_event_assignments',
  {
    coordinatorId: uuid('coordinator_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    eventId: uuid('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    assignedAt: timestamp('assigned_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.coordinatorId, table.eventId] })],
)

export const competitors = pgTable(
  'competitors',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    eventId: uuid('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    bibNumber: integer('bib_number').notNull(),
    firstName: text('first_name').notNull(),
    lastName: text('last_name').notNull(),
    checkedInAt: timestamp('checked_in_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('competitors_event_bib_unique').on(
      table.eventId,
      table.bibNumber,
    ),
  ],
)

export const divisions = pgTable('divisions', {
  id: uuid('id').primaryKey().defaultRandom(),
  eventId: uuid('event_id')
    .notNull()
    .references(() => events.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  type: divisionType('type').notNull(),
  scoringMode: divisionScoringMode('scoring_mode').notNull().default('numeric'),
  showCompetitorNames: boolean('show_competitor_names').notNull().default(true),
  advanceCount: integer('advance_count'),
  lineUpCheckInCompletedAt: timestamp('line_up_check_in_completed_at', {
    withTimezone: true,
  }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const divisionRegistrations = pgTable(
  'division_registrations',
  {
    divisionId: uuid('division_id')
      .notNull()
      .references(() => divisions.id, { onDelete: 'cascade' }),
    competitorId: uuid('competitor_id')
      .notNull()
      .references(() => competitors.id, { onDelete: 'cascade' }),
    role: dancerRole('role').notNull(),
    checkedInAt: timestamp('checked_in_at', { withTimezone: true }),
  },
  (table) => [
    primaryKey({ columns: [table.divisionId, table.competitorId] }),
  ],
)

export const divisionPairs = pgTable(
  'division_pairs',
  {
    divisionId: uuid('division_id')
      .notNull()
      .references(() => divisions.id, { onDelete: 'cascade' }),
    leadCompetitorId: uuid('lead_competitor_id')
      .notNull()
      .references(() => competitors.id, { onDelete: 'cascade' }),
    followCompetitorId: uuid('follow_competitor_id')
      .notNull()
      .references(() => competitors.id, { onDelete: 'cascade' }),
  },
  (table) => [
    primaryKey({ columns: [table.divisionId, table.leadCompetitorId] }),
    uniqueIndex('division_pairs_division_follow_unique').on(
      table.divisionId,
      table.followCompetitorId,
    ),
  ],
)

export const scoreSubmissions = pgTable(
  'score_submissions',
  {
    judgeId: uuid('judge_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    divisionId: uuid('division_id')
      .notNull()
      .references(() => divisions.id, { onDelete: 'cascade' }),
    status: scoreSubmissionStatus('status').notNull().default('editing'),
    scope: judgingScope('scope').notNull().default('both'),
    revision: integer('revision').notNull().default(0),
    submittedAt: timestamp('submitted_at', { withTimezone: true }),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.judgeId, table.divisionId] })],
)

export const scores = pgTable(
  'scores',
  {
    judgeId: uuid('judge_id').notNull(),
    divisionId: uuid('division_id').notNull(),
    competitorId: uuid('competitor_id')
      .notNull()
      .references(() => competitors.id, { onDelete: 'cascade' }),
    score: real('score').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({
      columns: [table.judgeId, table.divisionId, table.competitorId],
    }),
    foreignKey({
      columns: [table.judgeId, table.divisionId],
      foreignColumns: [scoreSubmissions.judgeId, scoreSubmissions.divisionId],
      name: 'scores_submission_fk',
    }).onDelete('cascade'),
    check('scores_range_check', sql`${table.score} between 1 and 10`),
  ],
)

export const divisionRounds = pgTable(
  'division_rounds',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    divisionId: uuid('division_id')
      .notNull()
      .references(() => divisions.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    type: roundType('type').notNull(),
    position: integer('position').notNull(),
    status: roundStatus('status').notNull().default('pending'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('division_rounds_division_position_unique').on(
      table.divisionId,
      table.position,
    ),
  ],
)

export const heats = pgTable('heats', {
  id: uuid('id').primaryKey().defaultRandom(),
  roundId: uuid('round_id')
    .notNull()
    .references(() => divisionRounds.id, { onDelete: 'cascade' }),
  position: integer('position').notNull(),
})

export const heatEntries = pgTable(
  'heat_entries',
  {
    heatId: uuid('heat_id')
      .notNull()
      .references(() => heats.id, { onDelete: 'cascade' }),
    competitorId: uuid('competitor_id')
      .notNull()
      .references(() => competitors.id, { onDelete: 'cascade' }),
    followCompetitorId: uuid('follow_competitor_id')
      .references(() => competitors.id, { onDelete: 'cascade' }),
  },
  (table) => [primaryKey({ columns: [table.heatId, table.competitorId] })],
)

export const roundSubmissions = pgTable(
  'round_submissions',
  {
    judgeId: uuid('judge_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    roundId: uuid('round_id')
      .notNull()
      .references(() => divisionRounds.id, { onDelete: 'cascade' }),
    status: scoreSubmissionStatus('status').notNull().default('editing'),
    scope: judgingScope('scope').notNull().default('both'),
    revision: integer('revision').notNull().default(0),
    submittedAt: timestamp('submitted_at', { withTimezone: true }),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.judgeId, table.roundId] })],
)

export const callbackVotes = pgTable(
  'callback_votes',
  {
    judgeId: uuid('judge_id').notNull(),
    roundId: uuid('round_id').notNull(),
    competitorId: uuid('competitor_id')
      .notNull()
      .references(() => competitors.id, { onDelete: 'cascade' }),
    vote: callbackVoteValue('vote').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({
      columns: [table.judgeId, table.roundId, table.competitorId],
    }),
    foreignKey({
      columns: [table.judgeId, table.roundId],
      foreignColumns: [roundSubmissions.judgeId, roundSubmissions.roundId],
      name: 'callback_votes_submission_fk',
    }).onDelete('cascade'),
  ],
)

export const placements = pgTable(
  'placements',
  {
    judgeId: uuid('judge_id').notNull(),
    roundId: uuid('round_id').notNull(),
    competitorId: uuid('competitor_id')
      .notNull()
      .references(() => competitors.id, { onDelete: 'cascade' }),
    rank: integer('rank').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({
      columns: [table.judgeId, table.roundId, table.competitorId],
    }),
    foreignKey({
      columns: [table.judgeId, table.roundId],
      foreignColumns: [roundSubmissions.judgeId, roundSubmissions.roundId],
      name: 'placements_submission_fk',
    }).onDelete('cascade'),
    check('placements_rank_check', sql`${table.rank} >= 1`),
  ],
)

export const roundImpressions = pgTable(
  'round_impressions',
  {
    judgeId: uuid('judge_id').notNull(),
    roundId: uuid('round_id').notNull(),
    competitorId: uuid('competitor_id')
      .notNull()
      .references(() => competitors.id, { onDelete: 'cascade' }),
    score: real('score').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({
      columns: [table.judgeId, table.roundId, table.competitorId],
    }),
    foreignKey({
      columns: [table.judgeId, table.roundId],
      foreignColumns: [roundSubmissions.judgeId, roundSubmissions.roundId],
      name: 'round_impressions_submission_fk',
    }).onDelete('cascade'),
    check(
      'round_impressions_score_check',
      sql`${table.score} >= 1 and ${table.score} <= 10`,
    ),
  ],
)
