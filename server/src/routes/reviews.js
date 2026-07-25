// Spaced-repetition review routes.
//
// A challenge is enrolled for review automatically the first time it's solved (see
// recordSolve). These two endpoints drive the review screen: fetch the queue of
// what's due, and grade a review to reschedule it. All the scheduling logic lives in
// services/review.js so it can be tested without HTTP. Auth is applied to the whole
// plugin scope in app.js.

import { buildReviewQueue, gradeReview } from '../services/review.js';

const GRADES = new Set(['again', 'good', 'easy']);

/**
 * @param {import('fastify').FastifyInstance} fastify
 */
export async function reviewRoutes(fastify) {
  const { db, store, config } = fastify;

  // The due-for-review queue plus its count (0 means "all caught up").
  fastify.get('/api/reviews', async () => {
    const { today, due } = buildReviewQueue(db, store, config.appTz);
    return { today, count: due.length, due };
  });

  // Grade a review: 'again' | 'good' | 'easy'. Reschedules the challenge and returns
  // when it's next due so the client can tell the user "back in N days".
  fastify.post('/api/reviews/:id/grade', async (request, reply) => {
    const id = request.params.id;
    if (!store.get(id)) return reply.code(404).send({ error: 'Challenge not found' });

    const grade = request.body?.grade;
    if (!GRADES.has(grade)) {
      return reply.code(400).send({ error: 'grade must be one of: again, good, easy' });
    }

    const row = gradeReview(db, id, grade, config.appTz);
    if (!row) return reply.code(404).send({ error: 'Challenge is not scheduled for review' });

    return { ok: true, dueDay: row.due_day, intervalDays: row.interval_days };
  });
}
