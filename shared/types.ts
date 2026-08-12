export type UserRole = 'admin' | 'judge'
export type DivisionType = 'jack_and_jill' | 'strictly'
export type DancerRole = 'lead' | 'follow'

export type SessionUser = {
  id: string
  email: string
  firstName: string
  lastName: string
  role: UserRole
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
  createdAt: string
}

export type Division = {
  id: string
  eventId: string
  name: string
  type: DivisionType
  showCompetitorNames: boolean
  registrationCount: number
}

export type Judge = {
  id: string
  email: string
  firstName: string
  lastName: string
  events: Array<{ id: string; name: string }>
}

export type ScoreSubmissionStatus = 'editing' | 'locked'
export type JudgingScope = 'lead' | 'follow' | 'both'

export type ScoreEntry = {
  competitorId: string
  score: number
}
