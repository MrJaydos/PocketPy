// The reference solution. It's locked until the challenge is solved, or the user
// explicitly gives up (with a confirm, since it can't be un-seen). The solution text
// is fetched from the server only at reveal time.

import { useState } from 'react';

export default function SolutionPanel({ solved, solution, onReveal }) {
  const [confirming, setConfirming] = useState(false);

  if (solution) {
    return (
      <div className="stack">
        <p className="muted">Reference solution:</p>
        <pre className="solution-code">{solution}</pre>
      </div>
    );
  }

  if (solved) {
    return (
      <button onClick={() => onReveal(false)}>Show the reference solution</button>
    );
  }

  // Not solved yet — allow giving up, but confirm first.
  if (!confirming) {
    return (
      <div className="stack">
        <p className="muted">Solve the challenge to unlock the solution, or:</p>
        <button className="btn-ghost" onClick={() => setConfirming(true)}>
          Give up and show solution
        </button>
      </div>
    );
  }

  return (
    <div className="stack">
      <p>Show the solution? You’ll still be able to solve it yourself afterwards.</p>
      <div className="row">
        <button className="btn-danger" onClick={() => onReveal(true)}>
          Yes, show it
        </button>
        <button className="btn-ghost" onClick={() => setConfirming(false)}>
          Keep trying
        </button>
      </div>
    </div>
  );
}
