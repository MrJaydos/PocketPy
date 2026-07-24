// React hook that owns the Pyodide worker and gives the UI a simple, safe API:
//   const { ready, busy, run, submit, cancel } = usePyodide();
//
// It handles the three things that make in-browser execution tricky:
//   1. Timeout — a run that exceeds RUN_TIMEOUT_MS is abandoned.
//   2. Cancel  — the user can stop a runaway loop. The ONLY reliable way to stop
//      synchronous WASM is worker.terminate(), so cancel/timeout kill the worker and
//      immediately spawn a fresh one that starts warming up in the background (the
//      "warm spare"), so the next run isn't stuck behind a cold Pyodide init.
//   3. Stale results — a worker we've given up on might still post a result; we tag
//      every request with an id and ignore results for ids we've already settled.

import { useCallback, useEffect, useRef, useState } from 'react';

const RUN_TIMEOUT_MS = 10_000;

export function usePyodide() {
  const workerRef = useRef(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);

  // The single in-flight request: its id, how to resolve its promise, and its timer.
  const pendingRef = useRef(null);
  const idCounter = useRef(0);

  // Resolves once the current worker has finished loading Pyodide. Recreated each
  // time we spawn a new worker so callers always await the right instance.
  const readyPromiseRef = useRef(null);
  function freshReadyPromise() {
    let resolve;
    const promise = new Promise((r) => (resolve = r));
    readyPromiseRef.current = { promise, resolve };
  }

  // Create a worker, wire up its messages, and kick off Pyodide loading.
  const spawnWorker = useCallback(() => {
    setReady(false);
    freshReadyPromise();

    const worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });

    worker.onmessage = (event) => {
      const msg = event.data;
      if (msg.type === 'ready') {
        setReady(true);
        readyPromiseRef.current?.resolve();
        return;
      }
      if (msg.type === 'result') {
        const pending = pendingRef.current;
        // Ignore results for a request we already timed out / cancelled.
        if (!pending || pending.id !== msg.id) return;
        clearTimeout(pending.timer);
        pendingRef.current = null;
        setBusy(false);
        pending.resolve({ status: 'ok', ...msg });
      }
    };

    worker.postMessage({ type: 'warmup' }); // start loading Pyodide right away
    workerRef.current = worker;
  }, []);

  // Spawn on mount; tear down on unmount.
  useEffect(() => {
    spawnWorker();
    return () => {
      workerRef.current?.terminate();
      workerRef.current = null;
    };
  }, [spawnWorker]);

  // Kill the current worker mid-task and replace it with a fresh, warming one.
  const recycleWorker = useCallback(() => {
    workerRef.current?.terminate();
    spawnWorker();
  }, [spawnWorker]);

  // Settle the in-flight request with a non-ok status (timeout/cancel) and recycle.
  const settleAndRecycle = useCallback(
    (status) => {
      const pending = pendingRef.current;
      if (!pending) return;
      clearTimeout(pending.timer);
      pendingRef.current = null;
      setBusy(false);
      pending.resolve({ status });
      recycleWorker();
    },
    [recycleWorker],
  );

  const cancel = useCallback(() => settleAndRecycle('cancelled'), [settleAndRecycle]);

  // Shared dispatch for both run and submit.
  const dispatch = useCallback(async (message) => {
    // Wait for Pyodide to finish loading before we start the execution timer, so a
    // slow first-load on a phone doesn't count against the 10s run budget.
    await readyPromiseRef.current?.promise;

    return new Promise((resolve) => {
      const id = ++idCounter.current;
      const timer = setTimeout(() => settleAndRecycleRef.current('timeout'), RUN_TIMEOUT_MS);
      pendingRef.current = { id, resolve, timer };
      setBusy(true);
      workerRef.current?.postMessage({ ...message, id });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // settleAndRecycle is used inside a setTimeout created in dispatch; keep a ref so
  // the timer always calls the latest version without making dispatch depend on it.
  const settleAndRecycleRef = useRef(settleAndRecycle);
  useEffect(() => {
    settleAndRecycleRef.current = settleAndRecycle;
  }, [settleAndRecycle]);

  const run = useCallback((code) => dispatch({ type: 'run', code }), [dispatch]);
  const submit = useCallback(
    (code, tests) => dispatch({ type: 'submit', code, tests }),
    [dispatch],
  );

  return { ready, busy, run, submit, cancel };
}
