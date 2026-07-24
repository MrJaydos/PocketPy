// The row of Python symbols above the editor. Mobile keyboards make characters like
// : ( ) [ ] and _ slow to reach, so this puts the ones Python needs most within one
// tap. It scrolls horizontally if the screen is narrow.
//
// Each button calls back to the editor's imperative handle (passed in as `editor`).

/** The symbols to offer, in a sensible order for Python. */
const SYMBOLS = [':', '=', '(', ')', '[', ']', '"', "'", '_', '#', '.', '+', '-', '*'];

export default function SymbolToolbar({ editor }) {
  // Guard against the editor ref not being ready yet.
  const insert = (s) => editor.current?.insert(s);

  return (
    <div className="symbol-toolbar" role="toolbar" aria-label="Python symbols">
      {/* Tab inserts 4 spaces — the single most useful key for Python indentation. */}
      <button onClick={() => editor.current?.indent()} aria-label="Insert indent (4 spaces)">
        ⇥
      </button>
      {SYMBOLS.map((s) => (
        <button key={s} onClick={() => insert(s)} aria-label={`Insert ${s}`}>
          {s}
        </button>
      ))}
      <button onClick={() => editor.current?.undo()} aria-label="Undo">
        ↶
      </button>
    </div>
  );
}
