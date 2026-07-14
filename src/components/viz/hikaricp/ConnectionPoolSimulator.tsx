import { useEffect, useRef, useState } from 'react';

/**
 * Interactive HikariCP simulator: request threads borrow JDBC connections from
 * a fixed pool. Watch the handoff queue and connectionTimeout when the pool is
 * exhausted, leak detection when a thread never calls close(), and maxLifetime
 * retirement of old connections.
 */

const TICK_MS = 250;
const CONNECTION_TIMEOUT = 12; // 3s — waiting thread gives up (real default: 30s)
const LEAK_THRESHOLD = 16; // 4s — "apparent connection leak" (real: leakDetectionThreshold)
const MAX_LIFETIME = 80; // 20s — connection retired (real default: 30min)
const POOL_LIMIT = 6;

const BUSY_COLOR = '#7c6cff';
const IDLE_COLOR = '#34d399';
const WAIT_COLOR = '#fbbf24';
const LEAK_COLOR = '#f87171';
const GONE_COLOR = '#5c6270';

interface Conn {
  id: number;
  busyBy: number | null; // thread id
  age: number; // ticks since created
  heldFor: number; // ticks held by current borrower
  leaked: boolean;
  leakWarned: boolean;
}

interface Th {
  id: number;
  state: 'waiting' | 'running';
  waitLeft: number;
  runLeft: number;
  conn: number | null;
}

interface Sim {
  conns: Conn[];
  threads: Th[];
  connSeq: number;
  threadSeq: number;
  served: number;
  timeouts: number;
}

const queryDuration = () => 4 + Math.floor(Math.random() * 5); // 1–2s

const freshConn = (id: number): Conn => ({ id, busyBy: null, age: 0, heldFor: 0, leaked: false, leakWarned: false });

// minimumIdle defaults to maximumPoolSize → Hikari keeps a fixed, pre-filled pool
const initialSim = (poolSize: number): Sim => ({
  conns: Array.from({ length: poolSize }, (_, i) => freshConn(i + 1)),
  threads: [],
  connSeq: poolSize + 1,
  threadSeq: 1,
  served: 0,
  timeouts: 0,
});

export default function ConnectionPoolSimulator() {
  const [poolSize, setPoolSize] = useState(3);
  const [sim, setSim] = useState<Sim>(() => initialSim(3));
  const [event, setEvent] = useState(
    'Pool is pre-filled (minimumIdle = maximumPoolSize). Run queries, then exhaust the pool and leak a connection.',
  );

  const ref = useRef({ sim, poolSize });
  ref.current = { sim, poolSize };

  const acquire = (s: Sim, t: Th): Conn | null => {
    const idle = s.conns.find((c) => c.busyBy === null);
    if (!idle) return null;
    idle.busyBy = t.id;
    idle.heldFor = 0;
    t.conn = idle.id;
    t.state = 'running';
    return idle;
  };

  const submit = (n: number, leak = false) => {
    const next: Sim = structuredClone(ref.current.sim);
    let msg = '';
    for (let i = 0; i < n; i++) {
      const t: Th = { id: next.threadSeq, state: 'waiting', waitLeft: CONNECTION_TIMEOUT, runLeft: queryDuration(), conn: null };
      next.threadSeq += 1;
      next.threads.push(t);
      const got = acquire(next, t);
      if (got && leak) {
        got.leaked = true;
        t.runLeft = Number.POSITIVE_INFINITY;
        msg = `T${t.id} borrowed c${got.id} and will NEVER call close() — a leak. Watch leakDetectionThreshold (4s)…`;
      } else if (got) {
        msg = `T${t.id} → getConnection(): got c${got.id} from the pool instantly (in-process, ~microseconds).`;
      } else if (leak) {
        msg = `No idle connection to leak — T${t.id} is just queued like everyone else.`;
      } else {
        msg = `T${t.id} → pool exhausted (${poolSize}/${poolSize} busy) → parked in the handoff queue, connectionTimeout ticking (3s)…`;
      }
    }
    if (n > 1) msg = `${n} concurrent requests → ${next.threads.filter((t) => t.state === 'running').length} running, ${next.threads.filter((t) => t.state === 'waiting').length} waiting on the pool.`;
    setEvent(msg);
    setSim(next);
  };

  const closeLeaked = () => {
    const next: Sim = structuredClone(ref.current.sim);
    const c = next.conns.find((x) => x.leaked);
    if (!c) {
      setEvent('Nothing is leaked right now.');
      return;
    }
    next.threads = next.threads.filter((t) => t.id !== c.busyBy);
    c.busyBy = null;
    c.leaked = false;
    c.leakWarned = false;
    c.heldFor = 0;
    next.served += 1;
    setEvent(`close() finally called on c${c.id} → it's back in the pool. In real code: try-with-resources makes this impossible to forget.`);
    setSim(next);
  };

  const changePool = (delta: number) => {
    const n = Math.min(POOL_LIMIT, Math.max(1, ref.current.poolSize + delta));
    if (n === ref.current.poolSize) return;
    setPoolSize(n);
    setEvent(`maximumPoolSize → ${n}. The housekeeper adds/retires connections to match (minimumIdle = maximumPoolSize).`);
  };

  // Clock: run queries down, serve the handoff queue FIFO, age & retire conns
  useEffect(() => {
    const id = setInterval(() => {
      const { sim, poolSize } = ref.current;
      const next: Sim = structuredClone(sim);
      let msg: string | null = null;

      for (const c of next.conns) {
        c.age += 1;
        if (c.busyBy !== null) c.heldFor += 1;
        if (c.leaked && !c.leakWarned && c.heldFor >= LEAK_THRESHOLD) {
          c.leakWarned = true;
          msg = `⚠ WARN ProxyLeakTask — Apparent connection leak detected: c${c.id} held ${(c.heldFor * TICK_MS / 1000).toFixed(0)}s by T${c.busyBy} (stack trace logged).`;
        }
      }

      // running threads finish → close() returns the conn
      for (const t of [...next.threads]) {
        if (t.state !== 'running' || !Number.isFinite(t.runLeft)) continue;
        t.runLeft -= 1;
        if (t.runLeft <= 0) {
          const c = next.conns.find((x) => x.id === t.conn)!;
          c.busyBy = null;
          c.heldFor = 0;
          next.served += 1;
          next.threads = next.threads.filter((x) => x.id !== t.id);
        }
      }

      // handoff queue: oldest waiter first
      for (const t of next.threads.filter((x) => x.state === 'waiting')) {
        if (acquire(next, t)) {
          msg = `c${t.conn} returned to the pool → handed straight to waiting T${t.id}.`;
        }
      }

      // waiters count down to SQLTransientConnectionException
      for (const t of [...next.threads]) {
        if (t.state !== 'waiting') continue;
        t.waitLeft -= 1;
        if (t.waitLeft <= 0) {
          next.timeouts += 1;
          next.threads = next.threads.filter((x) => x.id !== t.id);
          msg = `☠ T${t.id}: SQLTransientConnectionException — connection is not available, request timed out after 3000ms.`;
        }
      }

      // maxLifetime: retire old idle conns, replace with fresh ones
      const old = next.conns.find((c) => c.busyBy === null && c.age >= MAX_LIFETIME);
      if (old) {
        const fresh = freshConn(next.connSeq);
        next.connSeq += 1;
        next.conns = next.conns.map((c) => (c.id === old.id ? fresh : c));
        msg = `c${old.id} hit maxLifetime (20s) → retired and replaced by fresh c${fresh.id}. Prevents stale/killed connections.`;
      }

      // housekeeper: match pool size to config
      while (next.conns.length < poolSize) {
        next.conns.push(freshConn(next.connSeq));
        next.connSeq += 1;
      }
      if (next.conns.length > poolSize) {
        const removable = next.conns.filter((c) => c.busyBy === null).slice(0, next.conns.length - poolSize);
        next.conns = next.conns.filter((c) => !removable.includes(c));
      }

      setSim(next);
      if (msg) setEvent(msg);
    }, TICK_MS);
    return () => clearInterval(id);
  }, []);

  const reset = () => {
    setPoolSize(3);
    setSim(initialSim(3));
    setEvent('Reset. Pool pre-filled with 3 fresh connections — Hikari pays connection cost at startup, not per request.');
  };

  const btn =
    'text-xs font-semibold rounded-md px-3 py-1.5 bg-[#1c1c23] text-[#e6e6eb] hover:bg-[#262630] cursor-pointer transition-colors';

  const waiting = sim.threads.filter((t) => t.state === 'waiting');
  const running = sim.threads.filter((t) => t.state === 'running');

  return (
    <div className="not-prose bg-[#0f0f14] border border-[#26262e] text-[#e6e6eb] rounded-xl p-4 md:p-5 my-3 font-mono text-sm">
      {/* status line */}
      <div className="text-[#6ee7b7] text-xs leading-relaxed min-h-12 mb-3 whitespace-pre-wrap">▸ {event}</div>

      {/* controls */}
      <div className="flex flex-wrap items-center gap-2 mb-4 pb-3 border-b border-[#26262e]">
        <button type="button" className={btn} onClick={() => submit(1)}>run query</button>
        <button type="button" className={btn} onClick={() => submit(8)}>burst ×8</button>
        <button type="button" className={btn} onClick={() => submit(1, true)}>leak a conn</button>
        <button type="button" className={btn} onClick={closeLeaked}>close() the leak</button>
        <span className="inline-flex items-center gap-1 text-[11px] text-[#8a8f99]">
          maximumPoolSize
          <button type="button" className="w-5 h-5 rounded bg-[#1c1c23] hover:bg-[#262630] cursor-pointer leading-none" onClick={() => changePool(-1)}>−</button>
          <span className="text-[#e6e6eb] font-bold w-4 text-center">{poolSize}</span>
          <button type="button" className="w-5 h-5 rounded bg-[#1c1c23] hover:bg-[#262630] cursor-pointer leading-none" onClick={() => changePool(1)}>+</button>
        </span>
        <button type="button" className={btn} onClick={reset}>reset</button>
      </div>

      {/* pool */}
      <div className="text-[11px] text-[#8a8f99] mb-1.5">
        connection pool ({sim.conns.filter((c) => c.busyBy !== null).length} busy / {sim.conns.length})
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mb-4">
        {sim.conns.map((c) => {
          const color = c.leaked ? LEAK_COLOR : c.busyBy !== null ? BUSY_COLOR : IDLE_COLOR;
          const agePct = Math.min(100, Math.round((c.age / MAX_LIFETIME) * 100));
          return (
            <div key={c.id} className="rounded-lg px-2.5 py-2" style={{ background: `${color}14`, border: `1px solid ${color}55` }}>
              <div className="flex justify-between text-[11px] font-bold mb-1" style={{ color }}>
                <span>c{c.id}</span>
                <span className="font-normal text-[#8a8f99]">
                  {c.leaked ? `LEAKED by T${c.busyBy}` : c.busyBy !== null ? `T${c.busyBy}` : 'idle'}
                </span>
              </div>
              <div className="h-1 rounded bg-[#26262e] overflow-hidden" title={`age ${(c.age * TICK_MS / 1000).toFixed(0)}s / maxLifetime 20s`}>
                <div className="h-full rounded" style={{ width: `${agePct}%`, background: agePct > 85 ? WAIT_COLOR : '#3f3f4d' }} />
              </div>
            </div>
          );
        })}
      </div>

      {/* threads */}
      <div className="text-[11px] text-[#8a8f99] mb-1.5">
        request threads · running {running.length} · waiting {waiting.length}
      </div>
      <div className="flex flex-wrap gap-2 mb-4 min-h-8">
        {sim.threads.length === 0 && <span className="text-xs text-[#5c6270]">none — click “run query”</span>}
        {running.map((t) => (
          <span key={t.id} className="text-[11px] font-bold rounded-md px-2 py-1" style={{ background: `${BUSY_COLOR}1a`, color: BUSY_COLOR, border: `1px solid ${BUSY_COLOR}55` }}>
            T{t.id} ▶ c{t.conn}
          </span>
        ))}
        {waiting.map((t) => (
          <span key={t.id} className="text-[11px] font-bold rounded-md px-2 py-1" style={{ background: `${WAIT_COLOR}1a`, color: WAIT_COLOR, border: `1px solid ${WAIT_COLOR}55` }}>
            T{t.id} ⏳ {(t.waitLeft * TICK_MS / 1000).toFixed(1)}s
          </span>
        ))}
      </div>

      {/* footer */}
      <div className="flex flex-wrap items-center gap-3 border-t border-[#26262e] pt-3 text-[11px]">
        <span className="text-[#34d399]">✓ served {sim.served}</span>
        <span style={{ color: sim.timeouts > 0 ? LEAK_COLOR : GONE_COLOR }}>☠ timeouts {sim.timeouts}</span>
        <span className="text-[#5c6270] ml-auto">
          <span style={{ color: IDLE_COLOR }}>■</span> idle · <span style={{ color: BUSY_COLOR }}>■</span> busy · <span style={{ color: LEAK_COLOR }}>■</span> leaked · bar = age vs maxLifetime
        </span>
      </div>
    </div>
  );
}
