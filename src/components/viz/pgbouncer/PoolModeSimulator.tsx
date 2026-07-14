import { useEffect, useRef, useState } from 'react';

/**
 * Interactive PgBouncer simulator: clients run transactions against a small
 * pool of real Postgres connections. Session mode binds a server connection
 * to a client for its whole lifetime; transaction mode releases it after every
 * commit — watch how many clients the same pool can serve in each mode.
 */

const TICK_MS = 250;
const MAX_CLIENTS = 8;
const POOL_LIMIT = 4;

const CLIENT_COLORS = ['#7c6cff', '#38bdf8', '#34d399', '#fbbf24', '#f472b6', '#a3e635', '#fb923c', '#22d3ee'];
const WAIT_COLOR = '#f87171';
const IDLE_COLOR = '#5c6270';

type Mode = 'session' | 'transaction';

interface Client {
  id: number;
  state: 'idle' | 'waiting' | 'active';
  conn: number | null; // server connection id
  txnLeft: number; // ticks remaining in current transaction
  nextTxn: number; // ticks until it wants the next transaction
}

interface ServerConn {
  id: number;
  boundTo: number | null; // client id
}

interface Sim {
  clients: Client[];
  conns: ServerConn[];
  clientSeq: number;
  connSeq: number;
  completed: number;
}

const initialSim: Sim = { clients: [], conns: [], clientSeq: 1, connSeq: 1, completed: 0 };

const txnDuration = () => 4 + Math.floor(Math.random() * 5); // 1–2s
const idleGap = () => 3 + Math.floor(Math.random() * 10); // 0.75–3s

export default function PoolModeSimulator() {
  const [sim, setSim] = useState<Sim>(initialSim);
  const [mode, setMode] = useState<Mode>('session');
  const [poolSize, setPoolSize] = useState(2);
  const [event, setEvent] = useState(
    'Add clients and watch them share the server pool. Start in session mode, then switch to transaction mode and compare.',
  );

  const ref = useRef({ sim, mode, poolSize });
  ref.current = { sim, mode, poolSize };

  // Try to give client c a server connection; creates one lazily up to poolSize
  const acquire = (s: Sim, c: Client, poolSize: number): ServerConn | null => {
    const free = s.conns.find((sc) => sc.boundTo === null);
    if (free) {
      free.boundTo = c.id;
      return free;
    }
    if (s.conns.length < poolSize) {
      const sc: ServerConn = { id: s.connSeq, boundTo: c.id };
      s.conns.push(sc);
      s.connSeq += 1;
      return sc;
    }
    return null;
  };

  const addClient = () => {
    const { sim, mode, poolSize } = ref.current;
    if (sim.clients.length >= MAX_CLIENTS) return;
    const next: Sim = structuredClone(sim);
    const c: Client = { id: next.clientSeq, state: 'idle', conn: null, txnLeft: 0, nextTxn: idleGap() };
    next.clientSeq += 1;
    next.clients.push(c);
    if (mode === 'session') {
      const sc = acquire(next, c, poolSize);
      if (sc) {
        c.conn = sc.id;
        setEvent(`C${c.id} connected → session mode binds server conn S${sc.id} to it for the WHOLE session, even while idle.`);
      } else {
        c.state = 'waiting';
        setEvent(`C${c.id} connected but all ${poolSize} server conns are bound to other sessions → C${c.id} waits (cl_waiting).`);
      }
    } else {
      setEvent(`C${c.id} connected. In transaction mode it holds NO server conn until it actually starts a transaction.`);
    }
    setSim(next);
  };

  const removeClient = () => {
    const { sim, mode, poolSize } = ref.current;
    if (sim.clients.length === 0) return;
    const next: Sim = structuredClone(sim);
    const gone = next.clients.pop()!;
    let msg = `C${gone.id} disconnected.`;
    if (gone.conn !== null) {
      const sc = next.conns.find((x) => x.id === gone.conn)!;
      sc.boundTo = null;
      msg += ` Server conn S${sc.id} is free again`;
      if (mode === 'session') {
        const waiter = next.clients.find((c) => c.state === 'waiting' && c.conn === null && c.txnLeft === 0);
        if (waiter) {
          sc.boundTo = waiter.id;
          waiter.conn = sc.id;
          waiter.state = 'idle';
          waiter.nextTxn = idleGap();
          msg += ` → waiting client C${waiter.id} finally gets its session.`;
        } else {
          msg += '.';
        }
      } else {
        msg += ' → back in the pool.';
      }
    }
    void poolSize;
    setEvent(msg);
    setSim(next);
  };

  const switchMode = (m: Mode) => {
    const { sim } = ref.current;
    if (m === mode) return;
    const next: Sim = structuredClone(sim);
    // Clients reconnect under the new mode: drop all bindings and in-flight txns
    for (const sc of next.conns) sc.boundTo = null;
    for (const c of next.clients) {
      c.conn = null;
      c.txnLeft = 0;
      c.state = 'idle';
      c.nextTxn = idleGap();
    }
    if (m === 'session') {
      // Session mode: every client immediately needs a bound conn
      for (const c of next.clients) {
        const sc = acquire(next, c, ref.current.poolSize);
        if (sc) c.conn = sc.id;
        else c.state = 'waiting';
      }
      const waiting = next.clients.filter((c) => c.state === 'waiting').length;
      setEvent(
        `Switched to SESSION mode: every client needs its own server conn — ${waiting > 0 ? `${waiting} client${waiting > 1 ? 's' : ''} now stuck waiting.` : 'all clients got one.'}`,
      );
    } else {
      setEvent('Switched to TRANSACTION mode: conns are only borrowed during a transaction — watch the same pool serve everyone.');
    }
    setMode(m);
    setSim(next);
  };

  // Clock: clients start/finish transactions, conns get borrowed and returned
  useEffect(() => {
    const id = setInterval(() => {
      const { sim, mode, poolSize } = ref.current;
      if (sim.clients.length === 0) return;
      const next: Sim = structuredClone(sim);
      let msg: string | null = null;

      for (const c of next.clients) {
        // finish running transactions
        if (c.state === 'active') {
          c.txnLeft -= 1;
          if (c.txnLeft <= 0) {
            next.completed += 1;
            c.state = 'idle';
            c.nextTxn = idleGap();
            if (mode === 'transaction') {
              const sc = next.conns.find((x) => x.id === c.conn)!;
              sc.boundTo = null;
              c.conn = null;
              msg = `C${c.id} COMMIT → S${sc.id} released back to the pool immediately.`;
            }
          }
          continue;
        }

        // waiting clients (want a conn but pool was full)
        if (c.state === 'waiting') {
          const sc = acquire(next, c, poolSize);
          if (sc) {
            c.conn = sc.id;
            if (mode === 'transaction') {
              c.state = 'active';
              c.txnLeft = txnDuration();
              msg = `S${sc.id} freed up → waiting client C${c.id} grabs it and runs its transaction.`;
            } else {
              c.state = 'idle';
              c.nextTxn = idleGap();
              msg = `S${sc.id} freed up → C${c.id}'s session is finally established.`;
            }
          }
          continue;
        }

        // idle clients: count down to their next transaction
        c.nextTxn -= 1;
        if (c.nextTxn <= 0) {
          if (mode === 'session') {
            if (c.conn !== null) {
              c.state = 'active';
              c.txnLeft = txnDuration();
            } else {
              c.state = 'waiting'; // session never established yet
            }
          } else {
            const sc = acquire(next, c, poolSize);
            if (sc) {
              c.conn = sc.id;
              c.state = 'active';
              c.txnLeft = txnDuration();
            } else {
              c.state = 'waiting';
              msg = `C${c.id} wants a transaction but all ${poolSize} server conns are busy → cl_waiting.`;
            }
          }
        }
      }

      setSim(next);
      if (msg) setEvent(msg);
    }, TICK_MS);
    return () => clearInterval(id);
  }, []);

  const reset = () => {
    setSim(initialSim);
    setMode('session');
    setPoolSize(2);
    setEvent('Reset. No clients, no server connections — PgBouncer opens server conns lazily, only when needed.');
  };

  const clWaiting = sim.clients.filter((c) => c.state === 'waiting').length;
  const clActive = sim.clients.filter((c) => c.state === 'active').length;
  const svActive = sim.conns.filter((c) => c.boundTo !== null).length;
  const svIdle = sim.conns.length - svActive;

  const btn =
    'text-xs font-semibold rounded-md px-3 py-1.5 bg-[#1c1c23] text-[#e6e6eb] hover:bg-[#262630] cursor-pointer transition-colors';
  const colorOf = (clientId: number) => CLIENT_COLORS[(clientId - 1) % CLIENT_COLORS.length];

  return (
    <div className="not-prose bg-[#0f0f14] border border-[#26262e] text-[#e6e6eb] rounded-xl p-4 md:p-5 my-3 font-mono text-sm">
      {/* status line */}
      <div className="text-[#6ee7b7] text-xs leading-relaxed min-h-12 mb-3 whitespace-pre-wrap">▸ {event}</div>

      {/* controls */}
      <div className="flex flex-wrap items-center gap-2 mb-4 pb-3 border-b border-[#26262e]">
        <button type="button" className={btn} onClick={addClient}>+ client</button>
        <button type="button" className={btn} onClick={removeClient}>− client</button>
        <select
          value={mode}
          onChange={(e) => switchMode(e.target.value as Mode)}
          className="text-xs bg-[#0a0a0c] border border-[#26262e] rounded-md px-2 py-1.5 outline-none focus:border-[#7c6cff] cursor-pointer"
        >
          <option value="session">pool_mode = session</option>
          <option value="transaction">pool_mode = transaction</option>
        </select>
        <span className="inline-flex items-center gap-1 text-[11px] text-[#8a8f99]">
          pool_size
          <button type="button" className="w-5 h-5 rounded bg-[#1c1c23] hover:bg-[#262630] cursor-pointer leading-none" onClick={() => setPoolSize(Math.max(1, poolSize - 1))}>−</button>
          <span className="text-[#e6e6eb] font-bold w-4 text-center">{poolSize}</span>
          <button type="button" className="w-5 h-5 rounded bg-[#1c1c23] hover:bg-[#262630] cursor-pointer leading-none" onClick={() => setPoolSize(Math.min(POOL_LIMIT, poolSize + 1))}>+</button>
        </span>
        <button type="button" className={btn} onClick={reset}>reset</button>
      </div>

      {/* clients */}
      <div className="text-[11px] text-[#8a8f99] mb-1.5">app clients ({sim.clients.length})</div>
      <div className="flex flex-wrap gap-2 mb-4 min-h-9">
        {sim.clients.length === 0 && <span className="text-xs text-[#5c6270]">none — click “+ client”</span>}
        {sim.clients.map((c) => {
          const color = c.state === 'waiting' ? WAIT_COLOR : c.state === 'idle' ? IDLE_COLOR : colorOf(c.id);
          return (
            <span
              key={c.id}
              className="text-[11px] font-bold rounded-md px-2 py-1.5"
              style={{ background: `${color}1a`, color, border: `1px solid ${color}55` }}
            >
              C{c.id} · {c.state === 'active' ? `txn on S${c.conn}` : c.state === 'waiting' ? 'WAITING' : c.conn !== null ? `idle (holds S${c.conn})` : 'idle'}
            </span>
          );
        })}
      </div>

      {/* server pool */}
      <div className="text-[11px] text-[#8a8f99] mb-1.5">
        postgres server connections ({sim.conns.length}/{poolSize})
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
        {Array.from({ length: poolSize }, (_, i) => {
          const sc = sim.conns[i];
          if (!sc) {
            return (
              <div key={`e-${i}`} className="border border-dashed border-[#26262e] rounded-lg px-2.5 py-2.5 text-[11px] text-[#5c6270] text-center">
                not opened yet
              </div>
            );
          }
          const owner = sc.boundTo !== null ? sim.clients.find((c) => c.id === sc.boundTo) : null;
          const color = owner ? colorOf(owner.id) : IDLE_COLOR;
          return (
            <div key={sc.id} className="rounded-lg px-2.5 py-2.5 text-center" style={{ background: `${color}14`, border: `1px solid ${color}55` }}>
              <span className="text-[11px] font-bold" style={{ color }}>
                S{sc.id} {owner ? `→ C${owner.id}${owner.state === 'active' ? ' (txn)' : ' (held)'}` : '· idle in pool'}
              </span>
            </div>
          );
        })}
      </div>

      {/* SHOW POOLS footer */}
      <div className="flex flex-wrap items-center gap-3 border-t border-[#26262e] pt-3 text-[11px]">
        <span className="text-[#8a8f99]">SHOW POOLS →</span>
        <span className="text-[#34d399]">cl_active {clActive}</span>
        <span style={{ color: clWaiting > 0 ? WAIT_COLOR : '#5c6270' }}>cl_waiting {clWaiting}</span>
        <span className="text-[#38bdf8]">sv_active {svActive}</span>
        <span className="text-[#8a8f99]">sv_idle {svIdle}</span>
        <span className="text-[#5c6270] ml-auto">✓ {sim.completed} txns done</span>
      </div>
    </div>
  );
}
