// A pencil-written walkthrough: circles the thing to click, draws an arrow to it, and explains it in handwriting.
// Elements opt in with data-guide="<id>"; steps whose element is not on screen are skipped.
import { useEffect, useLayoutEffect, useState } from "react";

export type GuideStep = { id: string; text: string };
type Box = { x: number; y: number; w: number; h: number };

const NOTE_W = 270;

export default function Guide({ steps, onClose }: { steps: GuideStep[]; onClose: () => void }) {
  const live = steps.filter((s) => document.querySelector(`[data-guide="${s.id}"]`));
  const [i, setI] = useState(0);
  const [box, setBox] = useState<Box | null>(null);
  const step = live[i];
  const next = () => (i + 1 < live.length ? setI(i + 1) : onClose());

  // Bring the target into view when the step changes.
  useEffect(() => {
    const el = step && document.querySelector(`[data-guide="${step.id}"]`);
    el?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [step?.id]);

  // Track where the target is on screen.
  useLayoutEffect(() => {
    if (!step) return;
    let raf = 0;
    const measure = () => {
      const el = document.querySelector(`[data-guide="${step.id}"]`);
      if (!el) return setBox(null);
      const r = el.getBoundingClientRect();
      setBox((b) => (b && b.x === r.left && b.y === r.top && b.w === r.width && b.h === r.height ? b : { x: r.left, y: r.top, w: r.width, h: r.height }));
      raf = requestAnimationFrame(measure);
    };
    measure();
    return () => cancelAnimationFrame(raf);
  }, [step?.id]);

  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); if (e.key === "ArrowRight") next(); };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  });

  if (!step || !box) return null;

  // Place the note below the target if there is room, otherwise above; nudge it sideways so the arrow curves.
  const vw = window.innerWidth, vh = window.innerHeight;
  const below = box.y + box.h + 190 < vh;
  const cx = box.x + box.w / 2;
  const nx = Math.max(16, Math.min(vw - NOTE_W - 16, cx - NOTE_W / 2 + (cx > vw / 2 ? -90 : 90)));
  const ny = below ? box.y + box.h + 70 : Math.max(12, box.y - 70 - 150);
  // Arrow from the note's edge to the target's edge.
  const sx = nx + NOTE_W / 2, sy = below ? ny - 4 : ny + 150;
  const tx = cx, ty = below ? box.y + box.h + 10 : box.y - 10;
  const mx = (sx + tx) / 2 + (sx < tx ? -40 : 40), my = (sy + ty) / 2;
  const ang = Math.atan2(ty - my, tx - mx);
  const head = (d: number) => `M ${tx} ${ty} l ${-14 * Math.cos(ang + d)} ${-14 * Math.sin(ang + d)}`;
  const pad = 10;

  return (
    <div className="guide" role="dialog" aria-label="How to use SpecForge">
      <svg className="pencil" width={vw} height={vh} aria-hidden>
        <defs>
          <filter id="graphite">
            <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" result="grain" />
            <feDisplacementMap in="SourceGraphic" in2="grain" scale="2.4" />
          </filter>
        </defs>
        <g filter="url(#graphite)">
          <ellipse cx={cx} cy={box.y + box.h / 2} rx={box.w / 2 + pad + 6} ry={box.h / 2 + pad} transform={`rotate(-2 ${cx} ${box.y + box.h / 2})`} />
          <ellipse cx={cx + 2} cy={box.y + box.h / 2 + 1} rx={box.w / 2 + pad + 2} ry={box.h / 2 + pad + 3} transform={`rotate(1.5 ${cx} ${box.y + box.h / 2})`} className="faint" />
          <path d={`M ${sx} ${sy} Q ${mx} ${my} ${tx} ${ty}`} />
          <path d={head(0.45)} /><path d={head(-0.45)} />
        </g>
      </svg>
      <div className="gnote" style={{ left: nx, top: ny, width: NOTE_W }}>
        <p className="n-step">{i + 1} of {live.length}</p>
        <p className="n-text">{step.text}</p>
        <div className="n-row">
          <button onClick={onClose}>skip</button>
          {i > 0 && <button onClick={() => setI(i - 1)}>← back</button>}
          <button className="n-next" onClick={next}>{i + 1 < live.length ? "next →" : "got it ✓"}</button>
        </div>
      </div>
    </div>
  );
}
