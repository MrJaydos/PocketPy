// The row of Python symbols for the mobile keyboard. Mobile keyboards make characters
// like : ( ) [ ] and _ slow to reach, so this puts the ones Python needs most within
// one tap. It scrolls horizontally if the screen is narrow.
//
// On a phone it's `pinned`: positioned as a fixed bar in the gap ABOVE the on-screen
// keyboard (using the keyboard height measured by useVisualViewportInset). That gap is
// the one place iOS's native AutoFill/QuickType bar can't cover, since that bar sits
// on the keyboard itself. On desktop it renders inline under the editor.

/** The symbols to offer, in a sensible order for Python. */
const SYMBOLS = [':', '=', '(', ')', '[', ']', '"', "'", '_', '#', '.', '+', '-', '*'];

/**
 * @param {Object} props
 * @param {import('react').RefObject<any>} props.editor  Editor imperative handle.
 * @param {boolean} [props.pinned]      Fixed above the keyboard (mobile) vs inline (desktop).
 * @param {boolean} [props.visible]     When pinned, only shown while the editor is focused.
 * @param {number}  [props.bottomInset] When pinned, pixels of keyboard to sit above.
 */
export default function SymbolToolbar({ editor, pinned = false, visible = true, bottomInset = 0 }) {
  const insert = (s) => editor.current?.insert(s);

  // Tapping a button must NOT move focus off the editor — otherwise the keyboard
  // dismisses and this toolbar disappears. preventDefault on mousedown keeps focus in
  // the editor while still firing the button's onClick.
  const keepFocus = (e) => e.preventDefault();

  const style = pinned
    ? {
        position: 'fixed',
        left: 0,
        right: 0,
        bottom: bottomInset,
        zIndex: 40,
        display: visible ? 'flex' : 'none',
      }
    : undefined;

  return (
    <div
      className="symbol-toolbar"
      role="toolbar"
      aria-label="Python symbols"
      style={style}
      onMouseDown={keepFocus}
    >
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
