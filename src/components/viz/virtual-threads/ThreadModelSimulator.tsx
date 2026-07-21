import { useEffect, useRef, useState } from 'react';

/**
 * Side-by-side simulator: the SAME batch of blocking I/O tasks runs through a
 * fixed platform thread pool and through virtual threads at once. Watch the
 * platform pool bottleneck at poolSize while every virtual thread runs
 * concurrently — a blocked virtual thread unmounts, so it costs no carrier.
 */

const TICK_MS = 250;
const TASK_TICKS = 8; // each task blocks on I/O for ~2s
const POOL_MAX = 8;
const DISPLAY_CAP = 24; // cap virtual-thread dots drawn

const RUN_COLOR = '#7c6cff';
const IO_COLOR = '#38bdf8';
const IDLE_COLOR = '#34d399';
const WAIT_COLOR = '#fbbf24';

interface Task {
  id: number;
  remaining: number;
}

interface Sim {
  // platform side
  pRunning: Task[];
  pQueue: Task[];
  pDone: number;
  pElapsed: number;
  // virtual side
  vActive: Task[];
  vDone: number;
  vElapsed: number;
  seq: number;
}

const initial: Sim = { pRunning: [], pQueue: [], pDone: 0, pElapsed: 0, vActive: [], vDone: 0, vElapsed: 0, seq: 1 };

const secs = (ticks: number) => (ticks * TICK_MS / 1000).toFixed(1);

export default function ThreadModelSimulator() {
  const [sim, setSim] = useState<Sim>(initial);
  const [pool, setPool] = useState(4);
  const [carriers, setCarriers] = useState(2);
  const [event, setEvent] = useState(
    'Submit a batch of blocking I/O tasks. Both models get the SAME tasks — watch who finishes first.',
  );

  const ref = useRef({ sim, pool });
  ref.current = { sim, pool };

  const submit = (n: number) => {
    const s = ref.current.sim;
    const next: Sim = structuredClone(s);
    for (let i = 0; i < n; i++) {
      const idP = next.seq++;
      next.pQueue.push({ id: idP, remaining: TASK_TICKS });
      next.vActive.push({ id: idP, remaining: TASK_TICKS });
    }
    setEvent(
      `Submitted ${n} tasks to both. Platform pool runs ${ref.current.pool} at a time (rest queue); virtual threads ALL start at once — a blocked VT unmounts from its carrier.`,
    );
    setSim(next);
  };

  useEffect(() => {
    const id = setInterval(() => {
      const { sim, pool } = ref.current;
      const pBusy = sim.pRunning.length > 0 || sim.pQueue.length > 0;
      const vBusy = sim.vActive.length > 0;
      if (!pBusy && !vBusy) return;

      const next: Sim = structuredClone(sim);
      let msg: string | null = null;

      // ---- platform: only poolSize tasks progress; a blocked thread is still "used" ----
      if (pBusy) {
        next.pElapsed += 1;
        for (const t of next.pRunning) t.remaining -= 1;
        const finished = next.pRunning.filter((t) => t.remaining <= 0).length;
        next.pDone += finished;
        next.pRunning = next.pRunning.filter((t) => t.remaining > 0);
        while (next.pRunning.length < pool && next.pQueue.length > 0) {
          next.pRunning.push(next.pQueue.shift()!);
        }
      }

      // ---- virtual: every task progresses; blocking overlaps, no pool cap ----
      if (vBusy) {
        next.vElapsed += 1;
        for (const t of next.vActive) t.remaining -= 1;
        const vf = next.vActive.filter((t) => t.remaining <= 0).length;
        next.vDone += vf;
        next.vActive = next.vActive.filter((t) => t.remaining > 0);
      }

      // narrate the finish line
      const vJustDrained = sim.vActive.length > 0 && next.vActive.length === 0;
      const pJustDrained = sim.pRunning.length + sim.pQueue.length > 0 && next.pRunning.length === 0 && next.pQueue.length === 0;
      if (vJustDrained && (next.pRunning.length > 0 || next.pQueue.length > 0)) {
        msg = `Virtual threads DONE in ${secs(next.vElapsed)}s — all ran concurrently. Platform still grinding: ${next.pDone} done, ${next.pRunning.length + next.pQueue.length} to go.`;
      }
      if (pJustDrained) {
        const waves = Math.ceil(next.pDone / pool);
        msg = `Platform pool finished in ${secs(next.pElapsed)}s — ${next.pDone} tasks in ~${waves} wave(s) of ${pool}. Virtual threads had finished in ${secs(next.vElapsed)}s.`;
      }

      setSim(next);
      if (msg) setEvent(msg);
    }, TICK_MS);
    return () => clearInterval(id);
  }, []);

  const reset = () => {
    setSim(initial);
    setPool(4);
    setCarriers(2);
    setEvent('Reset. Submit a batch and compare — the gap grows as you add more tasks.');
  };

  const btn =
    'text-xs font-semibold rounded-md px-3 py-1.5 bg-[#1c1c23] text-[#e6e6eb] hover:bg-[#262630] cursor-pointer transition-colors';
  const stepper = (label: string, val: number, dec: () => void, inc: () => void) => (
    <span className="inline-flex items-center gap-1 text-[11px] text-[#8a8f99]">
      {label}
      <button type="button" className="w-5 h-5 rounded bg-[#1c1c23] hover:bg-[#262630] cursor-pointer leading-none" onClick={dec}>−</button>
      <span className="text-[#e6e6eb] font-bold w-4 text-center">{val}</span>
      <button type="button" className="w-5 h-5 rounded bg-[#1c1c23] hover:bg-[#262630] cursor-pointer leading-none" onClick={inc}>+</button>
    </span>
  );

  const pInFlight = sim.pRunning.length + sim.pQueue.length;

  const panelHead = 'text-[11px] font-bold mb-2 pb-1.5 border-b border-[#26262e]';

  return (
    <div className="not-prose bg-[#0f0f14] border border-[#26262e] text-[#e6e6eb] rounded-xl p-4 md:p-5 my-3 font-mono text-sm">
      <div className="text-[#6ee7b7] text-xs leading-relaxed min-h-12 mb-3 whitespace-pre-wrap">▸ {event}</div>

      {/* controls */}
      <div className="flex flex-wrap items-center gap-2 mb-4 pb-3 border-b border-[#26262e]">
        <button type="button" className={btn} onClick={() => submit(8)}>+8 tasks</button>
        <button type="button" className={btn} onClick={() => submit(24)}>+24 tasks</button>
        {stepper('poolSize', pool, () => setPool(Math.max(1, pool - 1)), () => setPool(Math.min(POOL_MAX, pool + 1)))}
        {stepper('carriers', carriers, () => setCarriers(Math.max(1, carriers - 1)), () => setCarriers(Math.min(POOL_MAX, carriers + 1)))}
        <button type="button" className={btn} onClick={reset}>reset</button>
      </div>

      <div className="grid md:grid-cols-2 gap-3">
        {/* PLATFORM */}
        <div className="rounded-lg border border-[#26262e] p-3">
          <div className={panelHead} style={{ color: RUN_COLOR }}>PLATFORM POOL · ExecutorService (fixed {pool})</div>
          <div className="text-[10px] text-[#8a8f99] mb-1">os threads ({sim.pRunning.length}/{pool} busy)</div>
          <div className="flex flex-wrap gap-1 mb-2 min-h-8">
            {Array.from({ length: pool }, (_, i) => {
              const t = sim.pRunning[i];
              return (
                <span
                  key={i}
                  className="w-9 h-8 rounded flex items-center justify-center text-[10px] font-bold"
                  style={
                    t
                      ? { background: `${IO_COLOR}1a`, color: IO_COLOR, border: `1px solid ${IO_COLOR}55` }
                      : { border: '1px dashed #26262e', color: '#5c6270' }
                  }
                  title={t ? `task #${t.id} — blocked on I/O, holding this thread` : 'idle thread'}
                >
                  {t ? `#${t.id}` : '·'}
                </span>
              );
            })}
          </div>
          <div className="text-[10px] mb-2" style={{ color: sim.pQueue.length ? WAIT_COLOR : '#5c6270' }}>
            queue: {sim.pQueue.length} waiting {sim.pQueue.length > 0 && '⏳ (blocked threads can’t be reused)'}
          </div>
          <div className="flex items-center justify-between text-[11px] border-t border-[#26262e] pt-2">
            <span style={{ color: IDLE_COLOR }}>✓ {sim.pDone} done</span>
            <span className="text-[#8a8f99]">{pInFlight} left · {secs(sim.pElapsed)}s</span>
          </div>
        </div>

        {/* VIRTUAL */}
        <div className="rounded-lg border border-[#26262e] p-3">
          <div className={panelHead} style={{ color: IO_COLOR }}>VIRTUAL THREADS · one per task, on {carriers} carriers</div>
          <div className="text-[10px] text-[#8a8f99] mb-1">
            carriers ({carriers}) — mostly idle: blocked VTs are unmounted
          </div>
          <div className="flex gap-1 mb-2">
            {Array.from({ length: carriers }, (_, i) => (
              <span
                key={i}
                className="w-9 h-8 rounded flex items-center justify-center text-[10px]"
                style={{ background: `${IDLE_COLOR}12`, color: IDLE_COLOR, border: `1px solid ${IDLE_COLOR}44` }}
                title="carrier (platform) thread — free while VTs are blocked"
              >
                C{i + 1}
              </span>
            ))}
          </div>
          <div className="text-[10px] text-[#8a8f99] mb-1">virtual threads in flight ({sim.vActive.length}) — all running</div>
          <div className="flex flex-wrap gap-1 mb-2 min-h-8">
            {sim.vActive.slice(0, DISPLAY_CAP).map((t) => (
              <span
                key={t.id}
                className="w-3.5 h-3.5 rounded-full"
                style={{ background: RUN_COLOR, opacity: 0.4 + 0.6 * (t.remaining / TASK_TICKS) }}
                title={`VT #${t.id} — blocked on I/O, unmounted (costs no carrier)`}
              />
            ))}
            {sim.vActive.length > DISPLAY_CAP && (
              <span className="text-[10px] text-[#5c6270]">+{sim.vActive.length - DISPLAY_CAP}</span>
            )}
            {sim.vActive.length === 0 && <span className="text-[10px] text-[#5c6270]">idle</span>}
          </div>
          <div className="flex items-center justify-between text-[11px] border-t border-[#26262e] pt-2">
            <span style={{ color: IDLE_COLOR }}>✓ {sim.vDone} done</span>
            <span className="text-[#8a8f99]">{sim.vActive.length} left · {secs(sim.vElapsed)}s</span>
          </div>
        </div>
      </div>

      <div className="text-[10px] text-[#5c6270] mt-3">
        each task = one blocking I/O call (~2s). Platform throughput is capped at poolSize; virtual throughput is capped by the I/O itself, not by threads.
      </div>
    </div>
  );
}
