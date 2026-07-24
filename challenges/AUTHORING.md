# Writing challenges

A challenge is a single **YAML** file anywhere under `challenges/`. Folders are just
for tidiness (they don't affect anything); the `topic` field is what groups
challenges in the app. Add a file, redeploy, done.

Validate your work any time with:

```bash
npm run validate:challenges   # runs every solution against its own tests in real Pyodide
```

The server also validates every file at startup and **refuses to boot** with a clear
message if one is malformed, so you can't ship a broken challenge by accident.

## Fields

```yaml
id: strings-caesar-cipher     # REQUIRED, unique, lowercase-dashed. Used in URLs + DB.
title: Caesar Cipher          # REQUIRED
topic: strings                # REQUIRED. Groups challenges; match a known topic slug.
tags: [strings, loops]        # optional
difficulty: 3                 # REQUIRED, 1..5
order: 30                     # sort order within the topic (low = earlier)
runner: pyodide               # optional; 'pyodide' (default) runs in the browser.
                              # 'server' runs in the sandboxed runner container: the
                              # tests stay hidden (never sent to the browser) and are
                              # graded server-side. Same YAML fields either way.
description: |                 # REQUIRED, Markdown
  Write a function `shift(text, n)` that ...
starter_code: |               # code pre-filled in the editor
  def shift(text, n):
      pass
tests: |                      # REQUIRED, Python. See "The check() harness" below.
  check(shift("abc", 1) == "bcd", "shift by 1")
hints:                        # optional, revealed one at a time
  - Think about the alphabet as 26 letters.
solution: |                   # REQUIRED, a working reference solution
  def shift(text, n):
      ...
```

Known `topic` slugs (map to nice labels in the UI): `syntax-variables`,
`control-flow`, `lists`, `loops`, `functions`, `strings`, `dictionaries`, `files`,
`classes`, `mixed`. A new slug still works — it just shows the raw slug as its heading.

## The `check()` harness

Your `tests` block runs in the browser *after* the user's code, in the same
namespace, so it can call the functions they defined. Instead of `assert`, use the
injected helper:

```python
check(condition, "a friendly message shown next to a ✓ or ✗")
```

`check()` **records** each result instead of stopping at the first failure, so the
user sees every check's outcome. Write one `check()` per thing you want to verify,
each with a clear message.

Rules of thumb:
- **Grade by return value**, not printed output (`input()` isn't supported).
- Cover the normal case, an edge case (empty input, zero, negatives), and any
  boundary the description promises.
- Keep messages short and human: `"wraps past z"`, not `"assert 1"`.

## Gotchas

- **Colons in strings.** A hint or line containing `": "` (colon then space) is
  parsed by YAML as a key/value map and will fail validation. **Quote it:**
  ```yaml
  hints:
    - 'Use an f-string: f"Hi {name}".'
  ```
- **Use block scalars (`|`) for code**, and indent the body two spaces. `|` keeps
  newlines and needs no escaping — ideal for Python.
- **`id` must be unique** across every file. Duplicate ids stop the server booting.
- **Always provide a `solution` that passes your own `tests`** — the validator
  checks this, and it's your safety net against an impossible challenge.
