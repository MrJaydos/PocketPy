// Progressive hints. The user reveals them one at a time; each reveal is recorded
// server-side (so "hints used" is tracked). The hint text itself comes from the
// server on demand, so unrevealed hints never reach the browser.

export default function Hints({ hintCount, revealed, onReveal }) {
  if (hintCount === 0) return <p className="muted">No hints for this one — you’ve got it.</p>;

  const allRevealed = revealed.length >= hintCount;

  return (
    <div className="stack">
      {revealed.map((text, i) => (
        <div className="hint" key={i}>
          <strong>Hint {i + 1}.</strong> {text}
        </div>
      ))}
      {!allRevealed ? (
        <button onClick={() => onReveal(revealed.length)}>
          {revealed.length === 0 ? 'Show a hint' : 'Show another hint'} ({revealed.length}/
          {hintCount})
        </button>
      ) : (
        <p className="muted">That’s all the hints.</p>
      )}
    </div>
  );
}
