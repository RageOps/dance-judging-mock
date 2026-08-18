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

export type Competitor = {
  id: string
  eventId: string
  bibNumber: number
  firstName: string
  lastName: string
}

export type Division = {
  id: string
  eventId: string
  name: string
  type: 'jack_and_jill' | 'strictly'
  showCompetitorNames: boolean
  registrationCount: number
}

export type Registration = {
  competitorId: string
  bibNumber: number
  firstName: string
  lastName: string
  role: 'lead' | 'follow'
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
  events: Array<{ id: string; name?: string }>
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

export type ScoreSheet = {
  event: Event
  division: Division
  scoringMode: 'individual' | 'pairs'
  status: 'editing' | 'locked'
  scope: 'lead' | 'follow' | 'both'
  revision: number
  submittedAt: string | null
  competitors: ScoreCompetitor[]
}

export type DivisionJudgeStatus = {
  id: string
  firstName: string
  lastName: string
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
}

export type PreliminaryPairResult = {
  leadCompetitorId: string
  leadBibNumber: number
  leadFirstName?: string
  followFirstName?: string
  submittedScoreCount: number
  average: number
}

export type DivisionStatus = {
  event: Event
  division: Division
  judges: {
    submitted: DivisionJudgeStatus[]
    pending: DivisionJudgeStatus[]
  }
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
