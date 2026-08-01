/**
 * Small subsequence fuzzy matcher.
 *
 * Returns a score (higher is better) or `null` when `query` isn't a
 * subsequence of `text`. Bonuses favour matches that a human would rank first:
 * consecutive characters, matches at word starts, and matches near the front.
 */
export function fuzzyScore(query: string, text: string): number | null {
  if (!query) return 0;

  const q = query.toLowerCase();
  const t = text.toLowerCase();

  // Exact substring is always the strongest signal.
  const direct = t.indexOf(q);
  if (direct !== -1) {
    return 1000 - direct * 2 + (direct === 0 ? 50 : 0);
  }

  let score = 0;
  let ti = 0;
  let streak = 0;

  for (const char of q) {
    let found = -1;
    while (ti < t.length) {
      if (t[ti] === char) {
        found = ti;
        break;
      }
      ti++;
    }
    if (found === -1) return null;

    score += 10;
    // Reward runs of adjacent matches, and matches that start a word.
    if (streak > 0 && found > 0 && t[found - 1] === q[q.indexOf(char) - 1]) score += 5;
    streak = found === ti ? streak + 1 : 1;
    if (found === 0 || t[found - 1] === " " || t[found - 1] === "-") score += 8;
    score -= Math.min(found, 20) * 0.1;

    ti = found + 1;
  }

  return score;
}

/** Filters and ranks `items` by how well `query` matches `key(item)`. */
export function fuzzyFilter<T>(
  items: T[],
  query: string,
  key: (item: T) => string,
  limit = 20,
): T[] {
  if (!query.trim()) return items.slice(0, limit);

  return items
    .map((item) => ({ item, score: fuzzyScore(query.trim(), key(item)) }))
    .filter((r): r is { item: T; score: number } => r.score !== null)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((r) => r.item);
}
