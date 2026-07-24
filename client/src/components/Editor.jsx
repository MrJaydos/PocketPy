// CodeMirror 6 editor, wrapped as a React component.
//
// CodeMirror is chosen over Monaco because it behaves far better with mobile virtual
// keyboards. We keep it deliberately minimal — Python highlighting, line numbers,
// undo history, 4-space indentation — and no autocomplete popovers, which are fiddly
// on a phone.
//
// The component is "uncontrolled": CodeMirror owns the text. We report changes up via
// onChange, and expose an imperative handle (insert/indent/undo/setDoc/focus) so the
// symbol toolbar and the Reset/Load-draft buttons can drive it.

import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { EditorState } from '@codemirror/state';
import { EditorView, keymap, lineNumbers } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, undo } from '@codemirror/commands';
import { indentUnit } from '@codemirror/language';
import { python } from '@codemirror/lang-python';
import { oneDark } from '@codemirror/theme-one-dark';

const Editor = forwardRef(function Editor({ initialDoc = '', onChange }, ref) {
  const hostRef = useRef(null);
  const viewRef = useRef(null);

  useEffect(() => {
    const state = EditorState.create({
      doc: initialDoc,
      extensions: [
        lineNumbers(),
        history(),
        keymap.of([...defaultKeymap, ...historyKeymap]),
        python(),
        oneDark,
        // Tell the OS keyboard this is a code field. On iOS this suppresses the
        // QuickType/AutoFill accessory bar (which otherwise overlaps our symbol
        // toolbar) and stops autocorrect from mangling code.
        EditorView.contentAttributes.of({
          autocapitalize: 'off',
          autocorrect: 'off',
          autocomplete: 'off',
          spellcheck: 'false',
        }),
        // Python is whitespace-sensitive; use 4 spaces everywhere.
        indentUnit.of('    '),
        EditorState.tabSize.of(4),
        EditorView.lineWrapping,
        // Report edits to the parent (for autosave / run).
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            onChange?.(update.state.doc.toString());
          }
        }),
      ],
    });

    const view = new EditorView({ state, parent: hostRef.current });
    viewRef.current = view;
    return () => view.destroy();
    // We intentionally create the editor once. External text changes go through the
    // imperative setDoc() handle, not prop updates, to avoid fighting the user's typing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useImperativeHandle(ref, () => ({
    /** Insert text at the cursor (replacing any selection). */
    insert(text) {
      const view = viewRef.current;
      if (!view) return;
      view.dispatch(view.state.replaceSelection(text));
      view.focus();
    },
    /** Insert one indent level (4 spaces). */
    indent() {
      this.insert('    ');
    },
    /** Undo the last change. */
    undo() {
      const view = viewRef.current;
      if (view) {
        undo(view);
        view.focus();
      }
    },
    /** Replace the whole document (used by Reset and Load-draft). */
    setDoc(text) {
      const view = viewRef.current;
      if (!view) return;
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: text },
      });
    },
    focus() {
      viewRef.current?.focus();
    },
  }));

  return <div className="editor-shell" ref={hostRef} />;
});

export default Editor;
