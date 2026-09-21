// Watches the quiz inside an embedded handout and reports each completed run.
//
// The handouts are static HTML under /training/… — same origin as the app —
// so the viewer's <iframe>.contentDocument is readable, and so are the
// srcdoc sub-frames the multi-document shells (equipment pages) create for
// their tabs (srcdoc inherits the parent origin). data: URL frames are
// opaque and skipped. Every quiz in the package uses the same tiny DOM
// contract (see manifest _readme):
//
//   #qDone  answered count     #qTot  question count     #qRight  correct
//   #qReset re-renders the quiz (counts drop to 0)
//
// A run is "finished" when qDone === qTot > 0; we report it once per run and
// re-arm after Reset. Polling (1 s) rather than MutationObserver because the
// shells mount tab frames lazily and a frame `load` replaces its document.
// Saved-state lives in a ref keyed by Document (StrictMode double-invokes
// effects; a ref survives, state would not). Never throws — a package that
// changed its ids simply records nothing.
import { useEffect, useRef, useState, type RefObject } from 'react';

export type QuizResult = { title: string; score: number; total: number };

function collectDocs(root: Document | null, depth = 0, out: Document[] = []): Document[] {
  if (!root) return out;
  out.push(root);
  if (depth >= 2) return out;
  let frames: HTMLCollectionOf<HTMLIFrameElement>;
  try { frames = root.getElementsByTagName('iframe'); } catch { return out; }
  for (const f of Array.from(frames)) {
    const d = frameDoc(f); // null for cross-origin / data: frames
    if (d) collectDocs(d, depth + 1, out);
  }
  return out;
}

function frameDoc(f: HTMLIFrameElement | null | undefined): Document | null {
  try { return f?.contentDocument ?? null; } catch { return null; }
}

function readQuiz(doc: Document): { done: number; total: number; right: number } | null {
  try {
    const qDone = doc.getElementById('qDone');
    const qTot = doc.getElementById('qTot');
    if (!qDone || !qTot) return null;
    const done = parseInt(qDone.textContent ?? '', 10);
    const total = parseInt(qTot.textContent ?? '', 10);
    const right = parseInt(doc.getElementById('qRight')?.textContent ?? '', 10);
    if (!Number.isFinite(done) || !Number.isFinite(total)) return null;
    return { done, total, right: Number.isFinite(right) ? right : 0 };
  } catch { return null; }
}

function titleOf(doc: Document): string {
  try {
    const t = (doc.title || '').trim();
    if (t) return t;
    const h = doc.querySelector('h1, h2');
    return (h?.textContent ?? '').trim();
  } catch { return ''; }
}

/**
 * @param iframeRef  the viewer frame
 * @param enabled    pause when nothing is open
 * @param onFinished called once per completed quiz run
 * @returns number of quiz documents currently detected (0 → no quiz on this page)
 */
export function useQuizWatcher(
  iframeRef: RefObject<HTMLIFrameElement | null>,
  enabled: boolean,
  onFinished: (r: QuizResult) => void,
): number {
  const [seen, setSeen] = useState(0);
  const savedRef = useRef<WeakMap<Document, boolean>>(new WeakMap());
  const cbRef = useRef(onFinished);
  useEffect(() => { cbRef.current = onFinished; });

  useEffect(() => {
    if (!enabled) return;
    savedRef.current = new WeakMap();
    const tick = () => {
      const docs = collectDocs(frameDoc(iframeRef.current));
      let n = 0;
      for (const d of docs) {
        const q = readQuiz(d);
        if (!q) continue;
        n++;
        const already = savedRef.current.get(d) === true;
        if (q.total > 0 && q.done >= q.total) {
          if (!already) {
            savedRef.current.set(d, true);
            cbRef.current({ title: titleOf(d), score: q.right, total: q.total });
          }
        } else if (already && q.done === 0) {
          savedRef.current.set(d, false); // Reset → arm the next run
        }
      }
      setSeen((prev) => (prev === n ? prev : n));
    };
    const id = window.setInterval(tick, 1000);
    tick();
    return () => window.clearInterval(id);
  }, [iframeRef, enabled]);

  return enabled ? seen : 0;
}
