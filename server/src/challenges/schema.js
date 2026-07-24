// The shape every challenge YAML file must conform to.
//
// We validate with zod at boot so that if you hand-author a challenge and get a
// field wrong, the server refuses to start with a message pointing at the exact
// file and field — far friendlier than a mysterious crash at request time.

import { z } from 'zod';

// A slug: lowercase letters, numbers and dashes. Used in URLs and as the DB key.
const slug = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'must be a lowercase-dashed slug, e.g. "strings-caesar-cipher"');

export const challengeSchema = z
  .object({
    id: slug,
    title: z.string().min(1),
    // Primary topic. Kept free-form (a string) rather than an enum so you can add
    // topics just by creating a folder + files, without editing code.
    topic: z.string().min(1),
    tags: z.array(z.string()).default([]),
    difficulty: z.number().int().min(1).max(5),
    order: z.number().int().default(0),
    // pyodide runs in the browser (Phase 1). "server" is reserved for the Phase 2
    // sandboxed runner and is accepted here but not yet executed.
    runner: z.enum(['pyodide', 'server']).default('pyodide'),
    description: z.string().min(1), // Markdown
    starter_code: z.string().default(''),
    // Python harness appended after the user's code. See AUTHORING.md for the
    // check(cond, msg) convention.
    tests: z.string().min(1),
    hints: z.array(z.string()).default([]),
    solution: z.string().min(1),
  })
  // Reject unknown keys so typos like `difficutly:` are caught instead of silently
  // ignored.
  .strict();

/** @typedef {z.infer<typeof challengeSchema>} Challenge */
