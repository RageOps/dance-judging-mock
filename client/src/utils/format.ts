export function judgeLabel(judge: {
  firstName: string
  lastName: string
}) {
  const initial = judge.lastName ? ` ${judge.lastName.charAt(0)}.` : ''
  return `${judge.firstName}${initial}`.trim()
}
