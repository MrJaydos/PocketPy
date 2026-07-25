// Choosing the "next" challenge for the Next button.
//
// The rule, in order (the order is the whole correctness of it):
//   1. Consider only challenges that are unsolved and aren't the current one.
//   2. Prefer the current topic: if it still has unsolved challenges, stay in it;
//      otherwise fall through to every topic.
//   3. Within that pool, take the easiest difficulty tier still present — this is
//      what makes the sequence get progressively harder as the easy ones clear.
//   4. Pick uniformly at random within that tier, so it isn't the same challenge
//      every time.
//
// Like the streak and review maths, this is a pure function with the randomness
// injected (`rng`), so it can be unit-tested deterministically.

/**
 * @param {Array<{id: string, topic: string, difficulty: number}>} challenges
 *   Challenge metadata (e.g. from store.list()).
 * @param {Set<string> | string[]} solvedIds  Ids the user has already solved.
 * @param {string} [currentId]  The challenge they're on now (excluded, and its
 *   topic is preferred). May be undefined (e.g. picking a first challenge).
 * @param {() => number} [rng]  Returns a float in [0, 1); defaults to Math.random.
 * @returns {string | null}  The chosen challenge id, or null if nothing is left.
 */
export function pickNextChallenge(challenges, solvedIds, currentId, rng = Math.random) {
  const solved = solvedIds instanceof Set ? solvedIds : new Set(solvedIds);

  // 1. Unsolved and not the one we're on.
  const candidates = challenges.filter((c) => c.id !== currentId && !solved.has(c.id));
  if (candidates.length === 0) return null;

  // 2. Prefer the current topic while it still has unsolved challenges.
  const current = challenges.find((c) => c.id === currentId);
  let pool = candidates;
  if (current) {
    const sameTopic = candidates.filter((c) => c.topic === current.topic);
    if (sameTopic.length > 0) pool = sameTopic;
  }

  // 3. Easiest difficulty tier present in that pool (computed AFTER topic filtering,
  //    or we'd leave the category early).
  const minDifficulty = Math.min(...pool.map((c) => c.difficulty));
  const easiest = pool.filter((c) => c.difficulty === minDifficulty);

  // 4. Uniform random within the tier. Clamp in case an injected rng returns 1.
  const index = Math.min(easiest.length - 1, Math.floor(rng() * easiest.length));
  return easiest[index].id;
}
