import { useEffect, useRef, useState } from 'react';

/**
 * Interactive ThreadPoolExecutor simulator: submit tasks and watch the real
 * decision order — spawn core worker → hand to idle worker → queue → spawn
 * non-core worker → reject. Non-core workers die after keep-alive idle time.
 */

const TICK_MS = 250;
const KEEP_ALIVE_TICKS = 12; // 3s idle → non-core worker terminates
const MAX_LIMIT = 6;
const QUEUE_LIMIT = 8;

const CORE_COLOR = '#7c6cff';
const TEMP_COLOR = '#fbbf24';
const QUEUE_COLOR = '#38bdf8';
const OK_COLOR = '#34d399';
const ERR_COLOR = '#f87171';

type Policy = 'Abort' | 'CallerRuns' | 'Discard' | 'DiscardOldest';

interface Task {
  id: number;
  total: number;
  remaining: number;
}

interface Worker {
  id: number;
  task: Task | null;
  idleTicks: number;
}

interface Sim {
  workers: Worker[];
  queue: Task[];
  caller: Task | null;
  completed: number;
  rejected: number;
  taskSeq: number;
  workerSeq: number;
}

const initialSim: Sim = {
  workers: [],
  queue: [],
  caller: null,
  completed: 0,
  rejected: 0,
  taskSeq: 1,
  workerSeq: 1,
};

function newTask(id: number): Task {
  const total = 8 + Math.floor(Math.random() * 12); // 2–5s
  return { id, total, remaining: total };
}

export default function ThreadPoolSimulator() {
  const [sim, setSim] = useState<Sim>(initialSim);
  const [core, setCore] = useState(2);
  const [max, setMax] = useState(4);
  const [cap, setCap] = useState(3);
  const [policy, setPolicy] = useState<Policy>('Abort');
  const [event, setEvent] = useState(
    'Submit tasks and watch the pool decide: core worker → idle worker → queue → temp worker → reject.',
  );

  const ref = useRef({ sim, core, max, cap });
  ref.current = { sim, core, max, cap };

  // One submission, following ThreadPoolExecutor's real execute() order
  const submitOne = (s: Sim): { s: Sim; msg: string } => {
    const t = newTask(s.taskSeq);
    const next: Sim = { ...s, taskSeq: s.taskSeq + 1, workers: s.workers.map((w) => ({ ...w })), queue: [...s.queue] };

    if (next.workers.length < core) {
      const w: Worker = { id: next.workerSeq, task: t, idleTicks: 0 };
      next.workers.push(w);
      next.workerSeq += 1;
      return { s: next, msg: `task #${t.id}: workers ${next.workers.length - 1} < core ${core} → spawned core worker W${w.id} (even if others were idle!)` };
    }

    const idle = next.workers.find((w) => w.task === null);
    if (idle) {
      idle.task = t;
      idle.idleTicks = 0;
      return { s: next, msg: `task #${t.id}: offered to queue → idle worker W${idle.id} took it instantly` };
    }

    if (next.queue.length < cap) {
      next.queue.push(t);
      return { s: next, msg: `task #${t.id}: all ${next.workers.length} workers busy → queued (${next.queue.length}/${cap})` };
    }

    if (next.workers.length < max) {
      const w: Worker = { id: next.workerSeq, task: t, idleTicks: 0 };
      next.workers.push(w);
      next.workerSeq += 1;
      return { s: next, msg: `task #${t.id}: queue FULL → spawned temp worker W${w.id} — note: it runs #${t.id} immediately, jumping the queue!` };
    }

    // Saturated → rejection policy
    switch (policy) {
      case 'Abort':
        next.rejected += 1;
        return { s: next, msg: `task #${t.id}: pool ${max}/${max} + queue ${cap}/${cap} → ☠ RejectedExecutionException (AbortPolicy)` };
      case 'Discard':
        return { s: next, msg: `task #${t.id}: saturated → silently discarded. No exception, no log, no trace (DiscardPolicy)` };
      case 'DiscardOldest': {
        const dropped = next.queue.shift()!;
        next.queue.push(t);
        return { s: next, msg: `task #${t.id}: saturated → dropped oldest queued task #${dropped.id}, enqueued #${t.id} (DiscardOldestPolicy)` };
      }
      case 'CallerRuns':
        if (next.caller) {
          return { s, msg: `caller thread is still running task #${next.caller.id} — it can't even submit right now. That's the backpressure.` };
        }
        next.caller = t;
        return { s: next, msg: `task #${t.id}: saturated → runs on the CALLER thread. Submitter is now blocked = natural backpressure (CallerRunsPolicy)` };
    }
  };

  const submit = (n: number) => {
    let s = ref.current.sim;
    let msg = '';
    for (let i = 0; i < n; i++) {
      const r = submitOne(s);
      s = r.s;
      msg = n === 1 ? r.msg : `${i + 1}× submit → last: ${r.msg}`;
    }
    setSim(s);
    setEvent(msg);
  };

  // Clock: run tasks down, refill idle workers from queue, kill idle temps
  useEffect(() => {
    const id = setInterval(() => {
      const { sim, core, cap } = ref.current;
      const isIdle =
        sim.workers.length === 0 && !sim.caller && sim.queue.length === 0 && sim.completed === 0 && sim.rejected === 0;
      if (isIdle) return;

      const next: Sim = { ...sim, workers: sim.workers.map((w) => ({ ...w })), queue: [...sim.queue] };
      let msg: string | null = null;

      for (const w of next.workers) {
        if (w.task) {
          w.task = { ...w.task, remaining: w.task.remaining - 1 };
          if (w.task.remaining <= 0) {
            next.completed += 1;
            w.task = null;
            w.idleTicks = 0;
          }
        }
      }

      // Idle workers block on queue.take() → grab the next task FIFO
      for (const w of next.workers) {
        if (!w.task && next.queue.length > 0) {
          w.task = next.queue.shift()!;
          w.idleTicks = 0;
          msg = `W${w.id} finished → took task #${w.task.id} from the queue (${next.queue.length}/${cap} left)`;
        }
      }

      for (const w of next.workers) {
        if (!w.task) w.idleTicks += 1;
      }

      // Workers beyond corePoolSize die after keepAliveTime idle
      const dead = next.workers.find((w, i) => i >= core && !w.task && w.idleTicks > KEEP_ALIVE_TICKS);
      if (dead) {
        next.workers = next.workers.filter((w) => w.id !== dead.id);
        msg = `W${dead.id} idle > keepAliveTime → terminated. Pool shrinks back toward core size (${next.workers.length} left)`;
      }

      if (next.caller) {
        next.caller = { ...next.caller, remaining: next.caller.remaining - 1 };
        if (next.caller.remaining <= 0) {
          next.completed += 1;
          msg = `caller thread finished task #${next.caller.id} — free to submit again`;
          next.caller = null;
        }
      }

      setSim(next);
      if (msg) setEvent(msg);
    }, TICK_MS);
    return () => clearInterval(id);
  }, []);

  const reset = () => {
    setSim(initialSim);
    setCore(2);
    setMax(4);
    setCap(3);
    setPolicy('Abort');
    setEvent('Reset. Pool is empty — workers are only created when tasks arrive (lazy).');
  };

  const btn =
    'text-xs font-semibold rounded-md px-3 py-1.5 bg-[#1c1c23] text-[#e6e6eb] hover:bg-[#262630] cursor-pointer transition-colors';

  const stepper = (label: string, value: number, dec: () => void, inc: () => void) => (
    <span className="inline-flex items-center gap-1 text-[11px] text-[#8a8f99]">
      {label}
      <button type="button" className="w-5 h-5 rounded bg-[#1c1c23] hover:bg-[#262630] cursor-pointer leading-none" onClick={dec}>−</button>
      <span className="text-[#e6e6eb] font-bold w-4 text-center">{value}</span>
      <button type="button" className="w-5 h-5 rounded bg-[#1c1c23] hover:bg-[#262630] cursor-pointer leading-none" onClick={inc}>+</button>
    </span>
  );

  return (
    <div className="not-prose bg-[#0f0f14] border border-[#26262e] text-[#e6e6eb] rounded-xl p-4 md:p-5 my-3 font-mono text-sm">
      {/* status line */}
      <div className="text-[#6ee7b7] text-xs leading-relaxed min-h-12 mb-3 whitespace-pre-wrap">▸ {event}</div>

      {/* controls */}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <button type="button" className={btn} onClick={() => submit(1)}>submit task</button>
        <button type="button" className={btn} onClick={() => submit(5)}>submit ×5</button>
        <select
          value={policy}
          onChange={(e) => {
            setPolicy(e.target.value as Policy);
            setEvent(`Rejection policy → ${e.target.value}. This only matters once the pool AND queue are full.`);
          }}
          className="text-xs bg-[#0a0a0c] border border-[#26262e] rounded-md px-2 py-1.5 outline-none focus:border-[#7c6cff] cursor-pointer"
        >
          <option value="Abort">AbortPolicy (default)</option>
          <option value="CallerRuns">CallerRunsPolicy</option>
          <option value="Discard">DiscardPolicy</option>
          <option value="DiscardOldest">DiscardOldestPolicy</option>
        </select>
        <button type="button" className={btn} onClick={reset}>reset</button>
      </div>

      {/* pool config */}
      <div className="flex flex-wrap items-center gap-4 mb-4 pb-3 border-b border-[#26262e]">
        {stepper('corePoolSize', core, () => setCore(Math.max(1, core - 1)), () => setCore(Math.min(max, core + 1)))}
        {stepper('maxPoolSize', max, () => setMax(Math.max(core, max - 1)), () => setMax(Math.min(MAX_LIMIT, max + 1)))}
        {stepper('queueCapacity', cap, () => setCap(Math.max(0, cap - 1)), () => setCap(Math.min(QUEUE_LIMIT, cap + 1)))}
      </div>

      {/* workers */}
      <div className="text-[11px] text-[#8a8f99] mb-1.5">
        worker threads ({sim.workers.length}/{max})
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2 mb-4">
        {Array.from({ length: max }, (_, i) => {
          const w = sim.workers[i];
          if (!w) {
            return (
              <div key={`empty-${i}`} className="border border-dashed border-[#26262e] rounded-lg px-2.5 py-2 text-[11px] text-[#5c6270] text-center">
                {i < core ? 'core slot (lazy)' : 'temp slot'}
              </div>
            );
          }
          const isCore = i < core;
          const color = isCore ? CORE_COLOR : TEMP_COLOR;
          const pct = w.task ? Math.round(((w.task.total - w.task.remaining) / w.task.total) * 100) : 0;
          return (
            <div key={w.id} className="rounded-lg px-2.5 py-2" style={{ background: `${color}14`, border: `1px solid ${color}55` }}>
              <div className="flex justify-between text-[11px] font-bold mb-1" style={{ color }}>
                <span>W{w.id} · {isCore ? 'core' : 'temp'}</span>
                <span className="text-[#8a8f99] font-normal">{w.task ? `#${w.task.id}` : 'idle'}</span>
              </div>
              {w.task ? (
                <div className="h-1.5 rounded bg-[#26262e] overflow-hidden">
                  <div className="h-full rounded transition-all duration-200" style={{ width: `${pct}%`, background: color }} />
                </div>
              ) : (
                <div className="text-[10px] text-[#5c6270]">
                  idle {(w.idleTicks * TICK_MS / 1000).toFixed(1)}s{!isCore && ` / keepAlive ${(KEEP_ALIVE_TICKS * TICK_MS / 1000).toFixed(0)}s`}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* queue */}
      <div className="text-[11px] text-[#8a8f99] mb-1.5">
        work queue ({sim.queue.length}/{cap})
      </div>
      <div className="flex items-center gap-1.5 mb-4 flex-wrap">
        {Array.from({ length: cap }, (_, i) => {
          const t = sim.queue[i];
          return t ? (
            <span
              key={t.id}
              className="w-9 h-7 rounded flex items-center justify-center text-[11px] font-bold text-[#0f0f14]"
              style={{ background: QUEUE_COLOR }}
            >
              #{t.id}
            </span>
          ) : (
            <span key={`q-${i}`} className="w-9 h-7 rounded border border-dashed border-[#26262e]" />
          );
        })}
        {cap === 0 && <span className="text-xs text-[#5c6270]">capacity 0 — direct handoff (SynchronousQueue, like newCachedThreadPool)</span>}
      </div>

      {/* caller thread */}
      {sim.caller && (
        <div className="flex items-center gap-2 mb-4 text-[11px] rounded-lg px-2.5 py-2" style={{ background: `${ERR_COLOR}14`, border: `1px solid ${ERR_COLOR}55`, color: ERR_COLOR }}>
          <span className="font-bold">⚠ main (caller) thread</span>
          <span>blocked running task #{sim.caller.id} — it cannot submit anything else</span>
          <div className="h-1.5 rounded bg-[#26262e] overflow-hidden flex-1 min-w-16">
            <div
              className="h-full rounded transition-all duration-200"
              style={{ width: `${Math.round(((sim.caller.total - sim.caller.remaining) / sim.caller.total) * 100)}%`, background: ERR_COLOR }}
            />
          </div>
        </div>
      )}

      {/* footer */}
      <div className="flex flex-wrap items-center gap-3 border-t border-[#26262e] pt-3 text-[11px]">
        <span style={{ color: OK_COLOR }}>✓ completed {sim.completed}</span>
        <span style={{ color: sim.rejected > 0 ? ERR_COLOR : '#5c6270' }}>☠ rejected {sim.rejected}</span>
        <span className="text-[#5c6270] ml-auto">
          <span style={{ color: CORE_COLOR }}>■</span> core · <span style={{ color: TEMP_COLOR }}>■</span> temp (dies after keepAlive) · <span style={{ color: QUEUE_COLOR }}>■</span> queued
        </span>
      </div>
    </div>
  );
}
