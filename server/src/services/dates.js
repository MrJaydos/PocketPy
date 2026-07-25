// Small shared date helpers used by both the streak math (progress.js) and the
// spaced-repetition schedule (review.js). Pulling them out here keeps those two
// services from importing each other.

/**
 * Which calendar day (YYYY-MM-DD) a given instant falls on, in a specific IANA
 * timezone. We use Intl rather than hand-rolling offset math so DST is handled
 * correctly. This is the single source of "what day is it".
 * @param {Date} date
 * @param {string} timeZone  IANA name, e.g. "Europe/London".
 * @returns {string} 'YYYY-MM-DD'
 */
export function dayInTz(date, timeZone) {
  // en-CA formats as YYYY-MM-DD, which is exactly what we want to store/sort.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

/**
 * Add `n` days to a 'YYYY-MM-DD' string, returning a new 'YYYY-MM-DD' string.
 * @param {string} day
 * @param {number} n
 */
export function addDays(day, n) {
  // Parse at UTC noon to stay clear of any DST edge when only adding whole days.
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
