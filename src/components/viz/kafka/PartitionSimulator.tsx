import { useEffect, useRef, useState } from 'react';

/**
 * Interactive Kafka topic simulator: produce keyed messages and watch them
 * hash to partitions with increasing offsets; add/remove consumers and watch
 * the group rebalance; consumers commit offsets over time so lag is visible.
 */

const NUM_PARTITIONS = 3;
const MAX_CONSUMERS = 4;
const PRESET_KEYS = ['user-42', 'user-7', 'order-99', 'cart-13', 'pay-5'];
const CONSUMER_COLORS = ['#ff6a3d', '#4f9cf9', '#2f9e63', '#c777f2'];
const VISIBLE_CELLS = 10;
const CONSUME_INTERVAL_MS = 900;

interface Msg {
  offset: number;
  key: string;
}

function hashKey(key: string): number {
  let h = 5381;
  for (let i = 0; i < key.length; i++) h = ((h << 5) + h + key.charCodeAt(i)) >>> 0;
  return h;
}

function keyColor(key: string): string {
  return `hsl(${hashKey(key) % 360} 60% 78%)`;
}

// Round-robin assignment: partition p → consumer p % n (extra consumers idle)
function ownerOf(partition: number, consumerCount: number): number {
  return partition % Math.min(consumerCount, NUM_PARTITIONS);
}

function assignmentLabel(consumerCount: number): string {
  const parts: string[] = [];
  for (let c = 0; c < consumerCount; c++) {
    const owned = [0, 1, 2].filter((p) => ownerOf(p, consumerCount) === c);
    parts.push(`C${c + 1} ← ${owned.length ? owned.map((p) => `P${p}`).join(',') : 'idle'}`);
  }
  return parts.join('   ');
}

export default function PartitionSimulator() {
  const [partitions, setPartitions] = useState<Msg[][]>([[], [], []]);
  const [committed, setCommitted] = useState<number[]>([0, 0, 0]);
  const [consumerCount, setConsumerCount] = useState(2);
  const [auto, setAuto] = useState(true);
  const [customKey, setCustomKey] = useState('');
  const [event, setEvent] = useState('Produce a message to get started — same key always lands on the same partition.');

  const stateRef = useRef({ partitions, committed, consumerCount });
  stateRef.current = { partitions, committed, consumerCount };

  // Each tick, every consumer commits one message from its most-lagging partition
  useEffect(() => {
    if (!auto) return;
    const id = setInterval(() => {
      const { partitions, committed, consumerCount } = stateRef.current;
      const next = [...committed];
      for (let c = 0; c < consumerCount; c++) {
        const owned = [0, 1, 2].filter((p) => ownerOf(p, consumerCount) === c);
        const laggy = owned
          .filter((p) => next[p] < partitions[p].length)
          .sort((a, b) => (partitions[b].length - next[b]) - (partitions[a].length - next[a]))[0];
        if (laggy !== undefined) next[laggy] += 1;
      }
      if (next.some((v, i) => v !== committed[i])) setCommitted(next);
    }, CONSUME_INTERVAL_MS);
    return () => clearInterval(id);
  }, [auto]);

  const produce = (key: string) => {
    const k = key.trim();
    if (!k) return;
    const hash = hashKey(k);
    const p = hash % NUM_PARTITIONS;
    setPartitions((prev) => {
      const next = prev.map((msgs) => [...msgs]);
      next[p].push({ offset: prev[p].length, key: k });
      return next;
    });
    setEvent(`produce(key="${k}")  →  hash ${hash} % ${NUM_PARTITIONS}  →  P${p} @ offset ${partitions[p].length}`);
  };

  const produceRandom = (n: number) => {
    setPartitions((prev) => {
      const next = prev.map((msgs) => [...msgs]);
      for (let i = 0; i < n; i++) {
        const k = PRESET_KEYS[Math.floor(Math.random() * PRESET_KEYS.length)];
        const p = hashKey(k) % NUM_PARTITIONS;
        next[p].push({ offset: next[p].length, key: k });
      }
      return next;
    });
    setEvent(`Produced ${n} messages with random keys — note each key sticks to one partition.`);
  };

  const changeConsumers = (delta: number) => {
    const n = Math.min(MAX_CONSUMERS, Math.max(1, consumerCount + delta));
    if (n === consumerCount) return;
    setConsumerCount(n);
    setEvent(`Rebalance!  Group now has ${n} consumer${n > 1 ? 's' : ''}:   ${assignmentLabel(n)}`);
  };

  const reset = () => {
    setPartitions([[], [], []]);
    setCommitted([0, 0, 0]);
    setConsumerCount(2);
    setEvent('Reset. Topic "orders" is empty again.');
  };

  const btn =
    'text-xs font-semibold rounded-md px-3 py-1.5 bg-[#2a2e37] text-[#e9ecf1] hover:bg-[#363b47] cursor-pointer transition-colors';

  return (
    <div className="not-prose bg-[#1a1d23] text-[#e9ecf1] rounded-xl p-4 md:p-5 my-3 font-mono text-sm">
      {/* status line */}
      <div className="text-[#8fd3a4] text-xs leading-relaxed min-h-8 mb-3 whitespace-pre-wrap">
        ▸ {event}
      </div>

      {/* controls */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        {PRESET_KEYS.map((k) => (
          <button key={k} type="button" className={btn} style={{ borderLeft: `3px solid ${keyColor(k)}` }} onClick={() => produce(k)}>
            {k}
          </button>
        ))}
        <input
          value={customKey}
          onChange={(e) => setCustomKey(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              produce(customKey);
              setCustomKey('');
            }
          }}
          placeholder="custom key ⏎"
          className="text-xs bg-[#0f1115] border border-[#2a2e37] rounded-md px-2.5 py-1.5 w-28 outline-none focus:border-[#ff6a3d] placeholder-[#5c6270]"
        />
        <span className="w-px h-5 bg-[#2a2e37] mx-1" />
        <button type="button" className={btn} onClick={() => produceRandom(5)}>+5 random</button>
        <button type="button" className={btn} onClick={() => changeConsumers(1)}>+ consumer</button>
        <button type="button" className={btn} onClick={() => changeConsumers(-1)}>− consumer</button>
        <button
          type="button"
          className={`${btn} ${auto ? 'text-[#8fd3a4]' : 'text-[#8a8f99]'}`}
          onClick={() => setAuto(!auto)}
        >
          auto-consume: {auto ? 'ON' : 'OFF'}
        </button>
        <button type="button" className={btn} onClick={reset}>reset</button>
      </div>

      {/* partitions */}
      <div className="space-y-2 mb-4">
        {partitions.map((msgs, p) => {
          const owner = ownerOf(p, consumerCount);
          const lag = msgs.length - committed[p];
          const hidden = Math.max(0, msgs.length - VISIBLE_CELLS);
          const visible = msgs.slice(hidden);
          return (
            <div key={p} className="flex items-center gap-2">
              <div
                className="w-20 shrink-0 text-xs font-bold rounded-md px-2 py-1.5 text-center"
                style={{ background: `${CONSUMER_COLORS[owner]}26`, color: CONSUMER_COLORS[owner], border: `1px solid ${CONSUMER_COLORS[owner]}55` }}
              >
                P{p} → C{owner + 1}
              </div>
              <div className="flex items-center gap-1 overflow-x-auto py-0.5 flex-1 min-w-0">
                {hidden > 0 && <span className="text-[10px] text-[#5c6270] shrink-0">+{hidden}…</span>}
                {visible.map((m) => {
                  const consumed = m.offset < committed[p];
                  const isNext = m.offset === committed[p];
                  return (
                    <span
                      key={m.offset}
                      title={`key=${m.key}, offset=${m.offset}${consumed ? ' (committed)' : ''}`}
                      className={`shrink-0 w-7 h-7 rounded flex items-center justify-center text-[11px] font-bold text-[#1a1d23] ${consumed ? 'opacity-30' : ''} ${isNext ? 'ring-2 ring-white' : ''}`}
                      style={{ background: keyColor(m.key) }}
                    >
                      {m.offset}
                    </span>
                  );
                })}
                {msgs.length === 0 && <span className="text-xs text-[#5c6270]">empty</span>}
              </div>
              <div className={`shrink-0 text-[11px] w-16 text-right ${lag > 0 ? 'text-[#ffb020]' : 'text-[#5c6270]'}`}>
                lag {lag}
              </div>
            </div>
          );
        })}
      </div>

      {/* consumer group */}
      <div className="flex flex-wrap items-center gap-2 border-t border-[#2a2e37] pt-3">
        <span className="text-[11px] text-[#8a8f99]">group “order-service”:</span>
        {Array.from({ length: consumerCount }, (_, c) => {
          const owned = [0, 1, 2].filter((p) => ownerOf(p, consumerCount) === c);
          return (
            <span
              key={c}
              className="text-[11px] font-bold rounded-full px-2.5 py-1"
              style={{ background: `${CONSUMER_COLORS[c]}26`, color: CONSUMER_COLORS[c], border: `1px solid ${CONSUMER_COLORS[c]}55` }}
            >
              C{c + 1} {owned.length ? `· ${owned.map((p) => `P${p}`).join(' ')}` : '· idle'}
            </span>
          );
        })}
        <span className="text-[11px] text-[#5c6270] ml-auto">
          ring = next offset to consume · dimmed = committed
        </span>
      </div>
    </div>
  );
}
