export type SessionUser = {
  id: string
  email: string
  firstName: string
  lastName: string
  role: 'admin' | 'judge' | 'coordinator'
}

export type Event = {
  id: string
  name: string
  eventDate: string | null
  createdAt: string
}

export type CompetitorDivision = {
  id: string
  name: string
  type: 'jack_and_jill' | 'strictly'
  role: 'lead' | 'follow'
}

export type Competitor = {
  id: string
  eventId: string
  bibNumber: number
  firstName: string
  lastName: string
  checkedInAt?: string | null
  divisions?: CompetitorDivision[]
}

export type JudgingStatus = 'not_started' | 'in_progress' | 'completed'

export type Division = {
  id: string
  eventId: string
  name: string
  type: 'jack_and_jill' | 'strictly'
  scoringMode: 'numeric' | 'rounds'
  showCompetitorNames: boolean
  advanceCount: number | null
  lineUpCheckInCompletedAt: string | null
  judgingStatus: JudgingStatus
  registrationCount: number
}

export type RoundType = 'callback' | 'relative_placement'
export type RoundStatus = 'pending' | 'active' | 'complete'
export type CallbackVote = 'yes' | 'alternate' | 'no'

export type HeatEntry = {
  competitorId: string
  bibNumber: number
  firstName?: string
  lastName?: string
  role?: 'lead' | 'follow'
  followCompetitorId?: string
  followBibNumber?: number
  followFirstName?: string
  followLastName?: string
}

export type RoundHeat = {
  id: string
  position: number
  entries: HeatEntry[]
}

export type DivisionRound = {
  id: string
  divisionId: string
  name: string
  type: RoundType
  advanceCount: number | null
  position: number
  status: RoundStatus
  createdAt: string
  heats: RoundHeat[]
  lockedSubmissions: number
  totalSubmissions: number
  myStatus?: 'not_started' | 'editing' | 'locked'
  myRevision?: number
}

export type RoundSheetEntry = HeatEntry & {
  mark: CallbackVote | number | null
  impression: number | null
}

export type RoundSheet = {
  event: Event
  division: Division
  round: {
    id: string
    divisionId: string
    name: string
    type: RoundType
    position: number
    status: RoundStatus
  }
  status: 'editing' | 'locked'
  scope: 'lead' | 'follow' | 'both'
  revision: number
  submittedAt: string | null
  heats: Array<{ id: string; position: number; entries: RoundSheetEntry[] }>
}

export type CallbackResultRow = HeatEntry & {
  yes: number
  alternate: number
  no: number
  points: number
  advancing?: boolean
}

export type PlacementResultRow = HeatEntry & {
  placement: number | null
  cumulativeCounts: number[]
}

export type RoundResults = {
  event: Event
  division: Division
  round: {
    id: string
    name: string
    type: RoundType
    position: number
    status: RoundStatus
  }
  judges: {
    submitted: DivisionJudgeStatus[]
    pending: DivisionJudgeStatus[]
  }
  results: {
    leads?: CallbackResultRow[]
    follows?: CallbackResultRow[]
    entries?: CallbackResultRow[]
    placements?: PlacementResultRow[]
    ballots?: Array<{ judgeId: string; ranks: Record<string, number> }>
    voteBallots?: Array<{
      judgeId: string
      votes: Record<string, CallbackVote>
    }>
  }
}

export type ImportPreviewPerson = {
  name: string
  firstName: string
  lastName: string
  jackAndJillRole: 'lead' | 'follow' | null
  inStrictly: boolean
  strictlyRole: 'lead' | 'follow' | null
  existing: boolean
}

export type ImportPreview = {
  people: ImportPreviewPerson[]
  divisions: { jackAndJill: string | null; strictly: string | null }
  warnings: string[]
  skippedRows: number
}

export type ImportResult = {
  competitorsCreated: number
  competitorsMatched: number
  registrationsAdded: number
  registrationsUpdated: number
  warnings: string[]
  skippedRows: number
}

export type Registration = {
  competitorId: string
  bibNumber: number
  firstName: string
  lastName: string
  role: 'lead' | 'follow'
  checkedInAt: string | null
  frontDeskCheckedInAt: string | null
}

export type DivisionPair = {
  leadCompetitorId: string
  followCompetitorId: string
  leadBib: number
  followBib: number
  leadFirstName: string
  leadLastName: string
  followFirstName: string
  followLastName: string
}

export type Judge = {
  id: string
  email: string
  firstName: string
  lastName: string
  events: Array<{ id: string; name?: string; isHead?: boolean }>
}

export type Coordinator = {
  id: string
  email: string
  firstName: string
  lastName: string
  events: Array<{ id: string; name?: string }>
}

export type JudgeDivision = Division & {
  competitorCount: number
  submissionStatus: 'not_started' | 'editing' | 'locked'
  revision: number
}

export type ScoreCompetitor = {
  competitorId: string
  followCompetitorId?: string
  bibNumber: number
  role?: 'lead' | 'follow'
  firstName?: string
  lastName?: string
  leadFirstName?: string
  followFirstName?: string
  score: number | null
}

export type AdvancementGroup = {
  role: 'lead' | 'follow' | 'pair'
  results: Array<{
    competitorId: string
    bibNumber: number
    points: number
    advancing: boolean
  }>
}

export type ScoreSheet = {
  event: Event
  division: Division
  scoringMode: 'individual' | 'pairs'
  status: 'editing' | 'locked'
  scope: 'lead' | 'follow' | 'both'
  revision: number
  submittedAt: string | null
  advancement?: {
    advanceCount: number
    groups: AdvancementGroup[]
  } | null
  competitors: ScoreCompetitor[]
}

export type DivisionJudgeStatus = {
  id: string
  firstName: string
  lastName: string
  isHead?: boolean
  status: 'not_started' | 'editing' | 'locked'
  scope: 'lead' | 'follow' | 'both' | null
  submittedAt: string | null
}

export type PreliminaryResult = {
  competitorId: string
  bibNumber: number
  firstName?: string
  lastName?: string
  role: 'lead' | 'follow'
  submittedScoreCount: number
  average: number
  points?: number
  placement: number | null
  advancing: boolean
}

export type PreliminaryPairResult = {
  leadCompetitorId: string
  leadBibNumber: number
  leadFirstName?: string
  followFirstName?: string
  submittedScoreCount: number
  average: number
  points?: number
  placement: number | null
  advancing: boolean
}

export type DivisionStatus = {
  event: Event
  division: Division
  judges: {
    submitted: DivisionJudgeStatus[]
    pending: DivisionJudgeStatus[]
  }
  ballots: Array<{ judgeId: string; scores: Record<string, number> }>
  preliminaryResults: {
    leads: PreliminaryResult[]
    follows: PreliminaryResult[]
    pairs: PreliminaryPairResult[]
  }
}

export class ApiError extends Error {
  status: number

  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

export async function api<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...options,
    credentials: 'include',
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers,
    },
  })

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as
      | { message?: string }
      | null
    throw new ApiError(body?.message ?? 'Request failed', response.status)
  }

  if (response.status === 204) return undefined as T
  return response.json() as Promise<T>
}
