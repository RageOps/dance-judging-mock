import 'dotenv/config'
import { sql } from '../db/client.js'

const baseUrl = process.env.TEST_BASE_URL ?? 'http://web'
const suffix = Date.now().toString()
const judgeEmail = `judge-integration-${suffix}@example.com`
const coordinatorEmail = `coordinator-integration-${suffix}@example.com`
const eventPrefix = `Integration ${suffix}`

let adminCookie = ''
let judgeCookie = ''
let coordinatorCookie = ''

async function request<T>(
  path: string,
  options: RequestInit = {},
  cookie = adminCookie,
): Promise<T> {
  const response = await fetch(`${baseUrl}/api${path}`, {
    ...options,
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
      ...options.headers,
    },
  })
  if (!response.ok) {
    throw new Error(`${options.method ?? 'GET'} ${path}: ${response.status} ${await response.text()}`)
  }
  if (response.status === 204) return undefined as T
  return response.json() as Promise<T>
}

async function login(email: string, password: string) {
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  if (!response.ok) throw new Error(`Login failed: ${response.status}`)
  const cookie = response.headers.get('set-cookie')?.split(';')[0]
  if (!cookie) throw new Error('Login did not set a session cookie')
  return cookie
}

async function expectStatus(
  path: string,
  status: number,
  options: RequestInit,
  cookie = judgeCookie,
) {
  const response = await fetch(`${baseUrl}/api${path}`, {
    ...options,
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
    },
  })
  if (response.status !== status) {
    throw new Error(
      `${options.method ?? 'GET'} ${path}: expected ${status}, got ${response.status}`,
    )
  }
}

try {
  adminCookie = await login(
    process.env.ADMIN_EMAIL ?? 'admin@local.dev',
    process.env.ADMIN_PASSWORD ?? '',
  )
  const eventA = await request<{ id: string }>('/events', {
    method: 'POST',
    body: JSON.stringify({ name: `${eventPrefix} A`, eventDate: '2026-08-10' }),
  })
  const eventB = await request<{ id: string }>('/events', {
    method: 'POST',
    body: JSON.stringify({ name: `${eventPrefix} B`, eventDate: '2026-08-11' }),
  })
  const eventC = await request<{ id: string }>('/events', {
    method: 'POST',
    body: JSON.stringify({ name: `${eventPrefix} C`, eventDate: '2026-08-12' }),
  })
  const lead = await request<{ id: string }>(
    `/events/${eventA.id}/competitors`,
    {
      method: 'POST',
      body: JSON.stringify({ firstName: 'Integration', lastName: 'Dancer' }),
    },
  )
  const follow = await request<{ id: string }>(
    `/events/${eventA.id}/competitors`,
    {
      method: 'POST',
      body: JSON.stringify({ firstName: 'Hidden', lastName: 'Follow' }),
    },
  )
  const division = await request<{ id: string }>(
    `/events/${eventA.id}/divisions`,
    {
      method: 'POST',
      body: JSON.stringify({
        name: 'Integration Division',
        type: 'jack_and_jill',
        showCompetitorNames: false,
      }),
    },
  )
  await request(
    `/events/${eventA.id}/divisions/${division.id}/registrations`,
    {
      method: 'PUT',
      body: JSON.stringify({
        registrations: [
          { competitorId: lead.id, role: 'lead' },
          { competitorId: follow.id, role: 'follow' },
        ],
      }),
    },
  )
  await request('/judges', {
    method: 'POST',
    body: JSON.stringify({
      firstName: 'Integration',
      lastName: 'Judge',
      email: judgeEmail,
      password: 'integration-password',
      eventIds: [eventA.id, eventB.id],
    }),
  })

  judgeCookie = await login(judgeEmail, 'integration-password')
  const assignedEvents = await request<Array<{ id: string }>>(
    '/judge/events',
    {},
    judgeCookie,
  )
  if (assignedEvents.length !== 2) throw new Error('Expected two assigned events')

  const hiddenSheet = await request<{
    scope: string
    competitors: Array<{ competitorId: string; firstName?: string }>
  }>(
    `/judge/events/${eventA.id}/divisions/${division.id}/scores`,
    {},
    judgeCookie,
  )
  if (
    hiddenSheet.scope !== 'both' ||
    hiddenSheet.competitors.some((item) => 'firstName' in item)
  ) {
    throw new Error('Hidden score sheet exposed a name or incorrect scope')
  }

  await expectStatus(
    `/judge/events/${eventA.id}/divisions/${division.id}/scores`,
    400,
    {
      method: 'PUT',
      body: JSON.stringify({
        expectedRevision: 0,
        scope: 'lead',
        scores: [{ competitorId: follow.id, score: 8 }],
      }),
    },
  )
  await expectStatus(
    `/judge/events/${eventA.id}/divisions/${division.id}/scores`,
    400,
    {
      method: 'PUT',
      body: JSON.stringify({
        expectedRevision: 0,
        scope: 'both',
        scores: [{ competitorId: lead.id, score: 8 }],
      }),
    },
  )

  const firstSave = await request<{ revision: number; status: string }>(
    `/judge/events/${eventA.id}/divisions/${division.id}/scores`,
    {
      method: 'PUT',
      body: JSON.stringify({
        expectedRevision: 0,
        scope: 'lead',
        scores: [{ competitorId: lead.id, score: 8 }],
      }),
    },
    judgeCookie,
  )
  if (firstSave.revision !== 1 || firstSave.status !== 'locked') {
    throw new Error('First save did not lock revision 1')
  }

  const lockedStatus = await request<{
    judges: { submitted: unknown[]; pending: unknown[] }
    preliminaryResults: { leads: Array<{ average: number; firstName?: string }> }
  }>(
    `/events/${eventA.id}/divisions/${division.id}/status`,
    {},
    judgeCookie,
  )
  if (
    lockedStatus.judges.submitted.length !== 1 ||
    lockedStatus.preliminaryResults.leads[0]?.average !== 8 ||
    'firstName' in lockedStatus.preliminaryResults.leads[0]
  ) {
    throw new Error('Locked judge status or hidden preliminary results are wrong')
  }

  const adminStatus = await request<{
    preliminaryResults: { leads: Array<{ firstName?: string }> }
  }>(`/events/${eventA.id}/divisions/${division.id}/status`)
  if (adminStatus.preliminaryResults.leads[0]?.firstName !== 'Integration') {
    throw new Error('Administrator status did not include competitor names')
  }

  await request(
    `/judge/events/${eventA.id}/divisions/${division.id}/scores/edit`,
    {
      method: 'POST',
      body: JSON.stringify({ expectedRevision: 1 }),
    },
    judgeCookie,
  )
  const editingStatus = await request<{
    judges: { submitted: unknown[]; pending: unknown[] }
    preliminaryResults: { leads: unknown[] }
  }>(
    `/events/${eventA.id}/divisions/${division.id}/status`,
    {},
    judgeCookie,
  )
  if (
    editingStatus.judges.pending.length !== 1 ||
    editingStatus.preliminaryResults.leads.length !== 0
  ) {
    throw new Error('Editing submission was not pending or affected averages')
  }

  const secondSave = await request<{ revision: number; status: string }>(
    `/judge/events/${eventA.id}/divisions/${division.id}/scores`,
    {
      method: 'PUT',
      body: JSON.stringify({
        expectedRevision: 1,
        scope: 'follow',
        scores: [{ competitorId: follow.id, score: 9 }],
      }),
    },
    judgeCookie,
  )
  if (secondSave.revision !== 2 || secondSave.status !== 'locked') {
    throw new Error('Edited save did not lock revision 2')
  }

  await request(
    `/judge/events/${eventA.id}/divisions/${division.id}/scores/edit`,
    {
      method: 'POST',
      body: JSON.stringify({ expectedRevision: 2 }),
    },
    judgeCookie,
  )
  const thirdSave = await request<{ revision: number; status: string }>(
    `/judge/events/${eventA.id}/divisions/${division.id}/scores`,
    {
      method: 'PUT',
      body: JSON.stringify({
        expectedRevision: 2,
        scope: 'both',
        scores: [
          { competitorId: lead.id, score: 7 },
          { competitorId: follow.id, score: 9 },
        ],
      }),
    },
    judgeCookie,
  )
  if (thirdSave.revision !== 3 || thirdSave.status !== 'locked') {
    throw new Error('Both-scope save did not lock revision 3')
  }

  await expectStatus(
    `/events/${eventC.id}/divisions/${division.id}/status`,
    403,
    {},
  )

  const strictlyLead = await request<{ id: string }>(
    `/events/${eventA.id}/competitors`,
    {
      method: 'POST',
      body: JSON.stringify({ firstName: 'Strict', lastName: 'Lead' }),
    },
  )
  const strictlyFollow = await request<{ id: string }>(
    `/events/${eventA.id}/competitors`,
    {
      method: 'POST',
      body: JSON.stringify({ firstName: 'Strict', lastName: 'Follow' }),
    },
  )
  const strictlyDivision = await request<{ id: string }>(
    `/events/${eventA.id}/divisions`,
    {
      method: 'POST',
      body: JSON.stringify({
        name: 'Strictly Integration Division',
        type: 'strictly',
        showCompetitorNames: false,
      }),
    },
  )
  await request(
    `/events/${eventA.id}/divisions/${strictlyDivision.id}/registrations`,
    {
      method: 'PUT',
      body: JSON.stringify({
        registrations: [
          { competitorId: strictlyLead.id, role: 'lead' },
          { competitorId: strictlyFollow.id, role: 'follow' },
        ],
      }),
    },
  )
  await request(
    `/events/${eventA.id}/divisions/${strictlyDivision.id}/pairs`,
    {
      method: 'PUT',
      body: JSON.stringify({
        pairs: [
          {
            leadCompetitorId: strictlyLead.id,
            followCompetitorId: strictlyFollow.id,
          },
        ],
      }),
    },
  )

  const pairSheet = await request<{
    scoringMode: string
    competitors: Array<{
      competitorId: string
      leadFirstName?: string
      followFirstName?: string
    }>
  }>(
    `/judge/events/${eventA.id}/divisions/${strictlyDivision.id}/scores`,
    {},
    judgeCookie,
  )
  if (
    pairSheet.scoringMode !== 'pairs' ||
    pairSheet.competitors.length !== 1 ||
    pairSheet.competitors[0]?.competitorId !== strictlyLead.id ||
    pairSheet.competitors.some(
      (item) => 'leadFirstName' in item || 'followFirstName' in item,
    )
  ) {
    throw new Error('Strictly score sheet did not return a hidden pair row')
  }

  await expectStatus(
    `/judge/events/${eventA.id}/divisions/${strictlyDivision.id}/scores`,
    400,
    {
      method: 'PUT',
      body: JSON.stringify({
        expectedRevision: 0,
        scores: [{ competitorId: strictlyFollow.id, score: 8 }],
      }),
    },
  )

  await request(
    `/judge/events/${eventA.id}/divisions/${strictlyDivision.id}/scores`,
    {
      method: 'PUT',
      body: JSON.stringify({
        expectedRevision: 0,
        scores: [{ competitorId: strictlyLead.id, score: 8 }],
      }),
    },
    judgeCookie,
  )

  const hiddenPairStatus = await request<{
    preliminaryResults: {
      pairs: Array<{ leadFirstName?: string; followFirstName?: string; average: number }>
    }
  }>(
    `/events/${eventA.id}/divisions/${strictlyDivision.id}/status`,
    {},
    judgeCookie,
  )
  if (
    hiddenPairStatus.preliminaryResults.pairs.length !== 1 ||
    hiddenPairStatus.preliminaryResults.pairs[0]?.average !== 8 ||
    'leadFirstName' in hiddenPairStatus.preliminaryResults.pairs[0]
  ) {
    throw new Error('Hidden strictly pair status exposed names or wrong average')
  }

  const adminPairStatus = await request<{
    preliminaryResults: {
      pairs: Array<{ leadFirstName?: string; followFirstName?: string }>
    }
  }>(`/events/${eventA.id}/divisions/${strictlyDivision.id}/status`)
  if (
    adminPairStatus.preliminaryResults.pairs[0]?.leadFirstName !== 'Strict' ||
    adminPairStatus.preliminaryResults.pairs[0]?.followFirstName !== 'Strict'
  ) {
    throw new Error('Administrator strictly status did not include pair first names')
  }

  await request('/coordinators', {
    method: 'POST',
    body: JSON.stringify({
      firstName: 'Integration',
      lastName: 'Coordinator',
      email: coordinatorEmail,
      password: 'integration-password',
      eventIds: [eventA.id],
    }),
  })

  coordinatorCookie = await login(coordinatorEmail, 'integration-password')

  const coordinatorEvents = await request<Array<{ id: string }>>(
    '/events',
    {},
    coordinatorCookie,
  )
  if (coordinatorEvents.length !== 1 || coordinatorEvents[0]?.id !== eventA.id) {
    throw new Error('Coordinator event list was not scoped to assignments')
  }

  await request(
    `/events/${eventA.id}/competitors`,
    {
      method: 'POST',
      body: JSON.stringify({ firstName: 'Coord', lastName: 'Managed' }),
    },
    coordinatorCookie,
  )

  await expectStatus(
    '/events',
    403,
    { method: 'POST', body: JSON.stringify({ name: 'Blocked event' }) },
    coordinatorCookie,
  )
  await expectStatus('/judges', 403, {}, coordinatorCookie)
  await expectStatus('/coordinators', 403, {}, coordinatorCookie)
  await expectStatus(
    `/events/${eventB.id}/competitors`,
    403,
    {
      method: 'POST',
      body: JSON.stringify({ firstName: 'Blocked', lastName: 'Competitor' }),
    },
    coordinatorCookie,
  )

  const coordinatorStatus = await request<{
    preliminaryResults: { leads: Array<{ firstName?: string }> }
  }>(
    `/events/${eventA.id}/divisions/${division.id}/status`,
    {},
    coordinatorCookie,
  )
  if (coordinatorStatus.preliminaryResults.leads[0]?.firstName !== 'Integration') {
    throw new Error('Coordinator status did not include competitor names')
  }

  console.log('Judge integration flow passed')
} finally {
  await sql`delete from users where email = ${judgeEmail}`
  await sql`delete from users where email = ${coordinatorEmail}`
  await sql`delete from events where name like ${`${eventPrefix}%`}`
  await sql.end()
}
