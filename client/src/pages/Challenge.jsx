// The challenge screen: description, editor, run/submit, hints, and solution.
//
// Layout is mobile-first. On a phone it's three tabs (Description / Code / Output);
// on a wide screen it becomes two panes side by side. All the Python execution goes
// through the usePyodide worker hook, so the UI stays responsive and a runaway loop
// can be cancelled.

import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import AppHeader from '../components/AppHeader.jsx';
import Editor from '../components/Editor.jsx';
import SymbolToolbar from '../components/SymbolToolbar.jsx';
import OutputPanel from '../components/OutputPanel.jsx';
import TestResults from '../components/TestResults.jsx';
import Tabs from '../components/Tabs.jsx';
import Markdown from '../components/Markdown.jsx';
import Hints from '../components/Hints.jsx';
import SolutionPanel from '../components/SolutionPanel.jsx';
import { usePyodide } from '../pyodide/usePyodide.js';
import { useMediaQuery } from '../hooks/useMediaQuery.js';
import { useVisualViewportInset } from '../hooks/useVisualViewportInset.js';
import { api } from '../api/client.js';
import { useAuth } from '../state/auth.jsx';
import { useToast } from '../state/toast.jsx';

const TABS = [
  { id: 'description', label: 'Task' },
  { id: 'code', label: 'Code' },
  { id: 'output', label: 'Output' },
];

export default function Challenge() {
  const { id } = useParams();
  const { handleUnauthorized } = useAuth();
  const showToast = useToast();
  const isDesktop = useMediaQuery('(min-width: 900px)');
  const keyboardInset = useVisualViewportInset();

  const editorRef = useRef(null);
  const codeRef = useRef(''); // latest editor text (avoids stale closures in callbacks)
  const saveTimer = useRef(null);

  const [challenge, setChallenge] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [activeTab, setActiveTab] = useState('description');
  const [editorFocused, setEditorFocused] = useState(false);

  // Server-run challenges (runner: "server") execute in the sandboxed runner
  // container via the backend; everything else runs in the Pyodide worker. We only
  // load Pyodide for the latter.
  const isServer = challenge?.runner === 'server';
  const { ready, busy, run, submit, cancel } = usePyodide({ enabled: !isServer });
  const [serverBusy, setServerBusy] = useState(false);
  const executing = isServer ? serverBusy : busy;
  const engineReady = isServer ? true : ready;

  // Execution state. `mode` says which result the Output pane should show.
  const [mode, setMode] = useState('run'); // 'run' | 'tests'
  const [runResult, setRunResult] = useState(null);
  const [submitResult, setSubmitResult] = useState(null);

  // Progress state.
  const [status, setStatus] = useState('not_started');
  const [revealedHints, setRevealedHints] = useState([]);
  const [solutionText, setSolutionText] = useState(null);

  // --- Load the challenge (and restore draft + previously revealed hints) --------
  useEffect(() => {
    let cancelled = false;
    api
      .getChallenge(id)
      .then(async (c) => {
        if (cancelled) return;
        setChallenge(c);
        setStatus(c.status);
        codeRef.current = c.draftCode ?? c.starter_code ?? '';

        // Re-fetch any hints the user had already unlocked so they persist across
        // reloads (revealing again is idempotent server-side).
        if (c.hintsUsed > 0) {
          const hints = [];
          for (let i = 0; i < c.hintsUsed; i++) {
            const r = await api.revealHint(id, i).catch(() => null);
            if (r) hints.push(r.hint);
          }
          if (!cancelled) setRevealedHints(hints);
        }
      })
      .catch((err) => {
        if (!handleUnauthorized(err)) setLoadError('Could not load this challenge.');
      });
    return () => {
      cancelled = true;
    };
  }, [id, handleUnauthorized]);

  // --- Autosave the draft, debounced -------------------------------------------
  const onCodeChange = useCallback(
    (text) => {
      codeRef.current = text;
      clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        api.saveDraft(id, text).catch(() => {
          /* autosave is best-effort; ignore transient failures */
        });
      }, 800);
    },
    [id],
  );

  // Flush a pending save when leaving the screen.
  useEffect(() => () => clearTimeout(saveTimer.current), []);

  // Show a "Solved!" toast with the streak (shared by both run engines).
  function celebrate(streakCurrent) {
    setStatus('solved');
    showToast(streakCurrent > 1 ? `Solved! 🔥 ${streakCurrent}-day streak` : 'Solved! 🎉');
  }

  // --- Run / Submit -------------------------------------------------------------
  async function onRun() {
    setMode('run');
    setRunResult(null);
    if (!isDesktop) setActiveTab('output');

    if (isServer) {
      setServerBusy(true);
      try {
        setRunResult(await api.runServer(id, codeRef.current));
      } catch (err) {
        if (!handleUnauthorized(err)) {
          setRunResult({ status: 'error', error: err.message || 'The runner is unavailable.' });
        }
      } finally {
        setServerBusy(false);
      }
      return;
    }

    setRunResult(await run(codeRef.current));
  }

  async function onSubmit() {
    setMode('tests');
    setSubmitResult(null);
    if (!isDesktop) setActiveTab('output');

    if (isServer) {
      // The runner container runs the hidden tests and grades authoritatively; the
      // backend records the solve, and we just reflect the outcome.
      setServerBusy(true);
      try {
        const result = await api.submitServer(id, codeRef.current);
        setSubmitResult(result);
        if (result.status === 'ok' && result.passed) celebrate(result.streak?.current ?? 0);
      } catch (err) {
        if (!handleUnauthorized(err)) {
          setSubmitResult({ status: 'error', error: err.message || 'The runner is unavailable.' });
        }
      } finally {
        setServerBusy(false);
      }
      return;
    }

    api.recordAttempt(id).catch(() => {});
    const result = await submit(codeRef.current, challenge.tests);
    setSubmitResult(result);

    // Only mark solved if the worker confirms every check passed (see the empty-
    // results guard in the worker — this can't be spoofed by an errored run).
    if (result.status === 'ok' && result.passed) {
      if (status !== 'solved') {
        try {
          const r = await api.recordSolve(id);
          celebrate(r.streak?.current ?? 0);
        } catch (err) {
          handleUnauthorized(err);
        }
      } else {
        showToast('Solved again ✅');
      }
    }
  }

  // --- Hints / solution ---------------------------------------------------------
  async function onRevealHint(index) {
    try {
      const r = await api.revealHint(id, index);
      setRevealedHints((prev) => [...prev, r.hint]);
    } catch (err) {
      handleUnauthorized(err);
    }
  }

  async function onRevealSolution(giveUp) {
    try {
      const r = await api.revealSolution(id, giveUp);
      setSolutionText(r.solution);
    } catch (err) {
      handleUnauthorized(err);
    }
  }

  function onReset() {
    const starter = challenge?.starter_code ?? '';
    editorRef.current?.setDoc(starter);
    codeRef.current = starter;
    api.saveDraft(id, starter).catch(() => {});
  }

  if (loadError) {
    return (
      <>
        <AppHeader title="Challenge" back="/challenges" />
        <main className="app-main">
          <p className="error-text">{loadError}</p>
        </main>
      </>
    );
  }

  if (!challenge) {
    return (
      <>
        <AppHeader title="Challenge" back="/challenges" />
        <main className="app-main">
          <p className="muted">Loading…</p>
        </main>
      </>
    );
  }

  // --- Panes (shared between mobile tabs and desktop columns) -------------------
  const descriptionPane = (
    <div className="stack">
      <div className="row">
        <span className={`status-dot ${status}`} aria-hidden="true" />
        <span className="muted">
          {status === 'solved' ? 'Solved' : status === 'attempted' ? 'In progress' : 'Not started'}
        </span>
      </div>
      <div className="card">
        <Markdown source={challenge.description} />
      </div>
      <details className="card">
        <summary>Hints</summary>
        <div style={{ marginTop: 10 }}>
          <Hints
            hintCount={challenge.hintCount}
            revealed={revealedHints}
            onReveal={onRevealHint}
          />
        </div>
      </details>
      <details className="card">
        <summary>Solution</summary>
        <div style={{ marginTop: 10 }}>
          <SolutionPanel
            solved={status === 'solved'}
            solution={solutionText}
            onReveal={onRevealSolution}
          />
        </div>
      </details>
    </div>
  );

  const codePane = (
    <div className="stack">
      <Editor
        ref={editorRef}
        initialDoc={codeRef.current}
        onChange={onCodeChange}
        onFocusChange={setEditorFocused}
      />
      <SymbolToolbar
        editor={editorRef}
        pinned={!isDesktop}
        visible={editorFocused}
        bottomInset={keyboardInset}
      />
      <div className="row">
        {/* Pyodide runs synchronously and can be cancelled by killing the worker;
            the server runner enforces its own timeout, so it shows no Stop button. */}
        {!isServer && busy ? (
          <button className="btn-danger" onClick={cancel}>
            Stop
          </button>
        ) : (
          <button className="btn-ghost" onClick={onRun} disabled={executing || !engineReady}>
            {engineReady ? 'Run' : 'Loading Python…'}
          </button>
        )}
        <button className="btn-primary" onClick={onSubmit} disabled={executing || !engineReady}>
          Submit
        </button>
        <div className="spacer" />
        <button className="btn-ghost" onClick={onReset} title="Reset to starter code">
          Reset
        </button>
      </div>
    </div>
  );

  const outputPane = (
    <div className="stack">
      {mode === 'run' ? (
        <OutputPanel result={runResult} running={executing && mode === 'run'} />
      ) : (
        <TestResults result={submitResult} running={executing && mode === 'tests'} />
      )}
    </div>
  );

  return (
    <>
      <AppHeader title={challenge.title} back="/challenges" />
      <main className="app-main stack">
        {isDesktop ? (
          <div className="challenge-panes">
            <div className="pane">{descriptionPane}</div>
            <div className="pane stack">
              {codePane}
              {outputPane}
            </div>
          </div>
        ) : (
          <>
            <Tabs tabs={TABS} active={activeTab} onChange={setActiveTab} />
            {activeTab === 'description' && descriptionPane}
            {activeTab === 'code' && codePane}
            {activeTab === 'output' && outputPane}
          </>
        )}
      </main>
    </>
  );
}
