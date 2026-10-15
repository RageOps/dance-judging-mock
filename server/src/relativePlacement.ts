/**
 * Relative Placement (RPSS) calculation.
 *
 * Each judge ranks every finalist 1..N. A competitor earns a placement once a
 * majority of judges have ranked them at that placement or better. Ties in a
 * majority column are broken by (1) higher count in that column, (2) lower sum
 * of the counted ranks, (3) cumulative counts in deeper columns, and finally
 * (4) the head judge's rank. Competitors still tied share the placement.
 */

export type RankedEntry = {
  competitorId: string
  /** One rank per judge who locked a ballot, e.g. [2, 1, 3]. */
  ranks: number[]
}

export type PlacementResult = {
  competitorId: string
  placement: number
  /** Cumulative majority counts per column, index = column - 1. */
  cumulativeCounts: number[]
}

export function computeRelativePlacement(
  entries: RankedEntry[],
  finalistCount: number,
  judgeCount: number,
  headRanks?: Map<string, number>,
): PlacementResult[] {
  // Lower head-judge rank wins; a missing rank never wins the tiebreak.
  const headDiff = (a: string, b: string) =>
    (headRanks?.get(a) ?? Number.MAX_SAFE_INTEGER) -
    (headRanks?.get(b) ?? Number.MAX_SAFE_INTEGER)
  const majority = Math.floor(judgeCount / 2) + 1
  const byId = new Map(entries.map((entry) => [entry.competitorId, entry]))
  const cumulative = new Map<string, number[]>()
  for (const entry of entries) {
    const counts = new Array<number>(finalistCount).fill(0)
    for (const rank of entry.ranks) {
      for (let column = rank; column <= finalistCount; column += 1) {
        counts[column - 1] = (counts[column - 1] ?? 0) + 1
      }
    }
    cumulative.set(entry.competitorId, counts)
  }
  const countsOf = (id: string) => cumulative.get(id) ?? []
  const entryOf = (id: string) => byId.get(id)!

  // Sum of the actual ranks counted within a column (ranks <= column).
  const rankSumWithin = (id: string, column: number) =>
    entryOf(id)
      .ranks.filter((rank) => rank <= column)
      .reduce((sum, rank) => sum + rank, 0)

  const placements = new Map<string, number>()
  const remaining = new Set(entries.map((entry) => entry.competitorId))
  let place = 1

  while (remaining.size) {
    let decided = false
    for (let column = place; column <= finalistCount && !decided; column += 1) {
      const candidates = [...remaining].filter(
        (id) => (countsOf(id)[column - 1] ?? 0) >= majority,
      )
      if (!candidates.length) continue

      // Order candidates: deeper majority first, then lower rank sum, then
      // lexicographic cumulative counts across subsequent columns.
      const sorted = candidates.sort((a, b) => {
        const countDiff =
          (countsOf(b)[column - 1] ?? 0) - (countsOf(a)[column - 1] ?? 0)
        if (countDiff) return countDiff
        const sumDiff = rankSumWithin(a, column) - rankSumWithin(b, column)
        if (sumDiff) return sumDiff
        for (let deeper = column + 1; deeper <= finalistCount; deeper += 1) {
          const deeperDiff =
            (countsOf(b)[deeper - 1] ?? 0) - (countsOf(a)[deeper - 1] ?? 0)
          if (deeperDiff) return deeperDiff
        }
        return headDiff(a, b)
      })

      // Fully tied candidates share the same placement number.
      const groups: string[][] = []
      for (const id of sorted) {
        const prev = groups.at(-1)?.at(-1)
        const tied =
          prev !== undefined &&
          countsOf(id)[column - 1] === countsOf(prev)[column - 1] &&
          rankSumWithin(id, column) === rankSumWithin(prev, column) &&
          countsOf(id)
            .slice(column)
            .every((count, index) => count === countsOf(prev)[column + index]) &&
          headDiff(id, prev) === 0
        if (tied) groups.at(-1)!.push(id)
        else groups.push([id])
      }

      for (const tiedGroup of groups) {
        for (const id of tiedGroup) {
          placements.set(id, place)
          remaining.delete(id)
        }
        place += tiedGroup.length
      }
      decided = true
    }

    if (!decided) {
      // No remaining competitor ever reaches a majority; rank by sum of all
      // ranks (fewer points = better), sharing placement on exact ties.
      const rankSum = (id: string) =>
        entryOf(id).ranks.reduce((sum, rank) => sum + rank, 0)
      const leftovers = [...remaining].sort(
        (a, b) => rankSum(a) - rankSum(b) || headDiff(a, b),
      )
      let lastSum = -1
      let lastHead = Number.MAX_SAFE_INTEGER
      let lastPlace = place
      for (const id of leftovers) {
        const sum = rankSum(id)
        const head = headRanks?.get(id) ?? Number.MAX_SAFE_INTEGER
        if (sum !== lastSum || head !== lastHead) {
          lastPlace = place
          lastSum = sum
          lastHead = head
        }
        placements.set(id, lastPlace)
        remaining.delete(id)
        place += 1
      }
    }
  }

  return entries.map((entry) => ({
    competitorId: entry.competitorId,
    placement: placements.get(entry.competitorId)!,
    cumulativeCounts: countsOf(entry.competitorId),
  }))
}
