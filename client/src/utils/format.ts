export function judgeLabel(judge: {
  firstName: string
  lastName: string
}) {
  const initial = judge.lastName ? ` ${judge.lastName.charAt(0)}.` : ''
  return `${judge.firstName}${initial}`.trim()
}

export function competitorLabel(entry: {
  bibNumber: number
  firstName?: string
  lastName?: string
  followBibNumber?: number
  followFirstName?: string
}) {
  const name = entry.firstName ? ` ${entry.firstName}` : ''
  const follow = entry.followBibNumber
    ? ` & #${entry.followBibNumber}${entry.followFirstName ? ` ${entry.followFirstName}` : ''}`
    : ''
  return `#${entry.bibNumber}${name}${follow}`
}
