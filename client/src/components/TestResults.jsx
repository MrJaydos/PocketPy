// Renders the outcome of a "Submit": a summary line plus one row per assertion with
// a friendly message. If the user's code errored before the tests could run, we say
// so clearly instead of showing a misleading "0 passed".

export default function TestResults({ result, running }) {
  if (running) return <div className="output-panel muted">Running tests…</div>;
  if (!result) return null;

  if (result.status === 'timeout') {
    return <div className="output-panel stderr">Tests timed out after 10 seconds.</div>;
  }
  if (result.status === 'cancelled') {
    return <div className="output-panel muted">Stopped.</div>;
  }

  // Code error before/while running tests.
  if (result.error) {
    return (
      <div className="stack">
        <div className="output-panel stderr">Your code has an error: {result.error}</div>
        {result.results?.length > 0 && <ResultRows results={result.results} />}
      </div>
    );
  }

  const passedCount = result.results.filter((r) => r.ok).length;
  const total = result.results.length;

  return (
    <div className="stack">
      <div className={passedCount === total ? 'streak-flame' : ''} style={{ fontSize: '1rem' }}>
        {passedCount === total ? '✅ ' : ''}
        <strong>
          {passedCount} of {total} checks passed
        </strong>
      </div>
      <ResultRows results={result.results} />
    </div>
  );
}

function ResultRows({ results }) {
  return (
    <div>
      {results.map((r, i) => (
        <div key={i} className={`test-result ${r.ok ? 'pass' : 'fail'}`}>
          <span className="icon" aria-hidden="true">
            {r.ok ? '✓' : '✗'}
          </span>
          <span>{r.msg || (r.ok ? 'passed' : 'failed')}</span>
        </div>
      ))}
    </div>
  );
}
