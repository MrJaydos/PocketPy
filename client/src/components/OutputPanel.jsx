// Shows the result of a "Run": stdout, stderr, and any status note (running,
// timed out, cancelled, or a code error). Kept plain-text and monospace, like a
// real console.

export default function OutputPanel({ result, running }) {
  if (running) {
    return <div className="output-panel muted">Running…</div>;
  }
  if (!result) {
    return (
      <div className="output-panel muted">
        Press <strong>Run</strong> to execute your code. Output appears here.
        {'\n\n'}Note: input() isn’t supported yet — write functions that return values.
      </div>
    );
  }

  // Non-ok statuses from the worker hook (timeout/cancel).
  if (result.status === 'timeout') {
    return <div className="output-panel stderr">Timed out after 10 seconds and was stopped.</div>;
  }
  if (result.status === 'cancelled') {
    return <div className="output-panel muted">Stopped.</div>;
  }

  return (
    <div className="output-panel">
      {result.error ? <span className="stderr">Error: {result.error}{'\n'}</span> : null}
      {result.stdout}
      {result.stderr ? <span className="stderr">{result.stderr}</span> : null}
      {!result.error && !result.stdout && !result.stderr ? (
        <span className="muted">(no output)</span>
      ) : null}
    </div>
  );
}
