import {
  boolean,
  check,
  date,
  foreignKey,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'

export const userRole = pgEnum('user_role', ['admin', 'judge'])
export const divisionType = pgEnum('division_type', ['jack_and_jill', 'strictly'])
export const dancerRole = pgEnum('dancer_role', ['lead', 'follow'])
export const scoreSubmissionStatus = pgEnum('score_submission_status', [
  'editing',
  'locked',
])
export const judgingScope = pgEnum('judging_scope', ['lead', 'follow', 'both'])

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
    assignedAt: timestamp('assigned_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.judgeId, table.eventId] })],
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
  showCompetitorNames: boolean('show_competitor_names').notNull().default(true),
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
    score: integer('score').notNull(),
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
