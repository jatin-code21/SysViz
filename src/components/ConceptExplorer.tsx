import { useMemo, useState } from 'react';
import Fuse from 'fuse.js';

export interface ConceptMeta {
  slug: string;
  title: string;
  description: string;
  category: string;
  tags: string[];
  updated: string; // pre-formatted label
  sections: string[]; // h2 texts, searchable + shown as count
}

interface Props {
  concepts: ConceptMeta[];
  base: string;
}

export default function ConceptExplorer({ concepts, base }: Props) {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<string | null>(null);

  const categories = useMemo(
    () => [...new Set(concepts.map((c) => c.category))].sort(),
    [concepts],
  );

  const fuse = useMemo(
    () =>
      new Fuse(concepts, {
        keys: [
          { name: 'title', weight: 3 },
          { name: 'tags', weight: 2 },
          { name: 'description', weight: 1 },
          { name: 'sections', weight: 1 },
        ],
        threshold: 0.35,
        ignoreLocation: true,
      }),
    [concepts],
  );

  const visible = useMemo(() => {
    const searched = query.trim() ? fuse.search(query.trim()).map((r) => r.item) : concepts;
    return category ? searched.filter((c) => c.category === category) : searched;
  }, [query, category, concepts, fuse]);

  // Group by category when browsing; keep relevance order while searching
  const grouped = useMemo(() => {
    if (query.trim()) return [['Results', visible]] as const;
    const map = new Map<string, ConceptMeta[]>();
    for (const c of visible) {
      map.set(c.category, [...(map.get(c.category) ?? []), c]);
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [visible, query]);

  const chip = (active: boolean) =>
    `text-sm rounded-full px-3.5 py-1.5 border transition-colors cursor-pointer ${
      active
        ? 'bg-accent-soft border-accent-line text-accent-ink shadow-[0_0_14px_rgba(124,108,255,.2)]'
        : 'border-line text-nav-ink hover:border-nav-muted'
    }`;

  return (
    <div>
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search concepts, tags, sections…  (e.g. “consumer group”, “singleton”)"
        autoComplete="off"
        className="w-full bg-panel border border-line text-white placeholder-nav-muted rounded-xl px-5 py-3.5 text-[.95rem] outline-none focus:border-accent-line focus:shadow-[0_0_20px_rgba(124,108,255,.15)] transition-shadow mb-4"
      />

      <div className="flex flex-wrap gap-2 mb-8">
        <button type="button" className={chip(category === null)} onClick={() => setCategory(null)}>
          All
        </button>
        {categories.map((cat) => (
          <button
            key={cat}
            type="button"
            className={chip(category === cat)}
            onClick={() => setCategory(category === cat ? null : cat)}
          >
            {cat}
          </button>
        ))}
      </div>

      {visible.length === 0 && (
        <p className="text-nav-muted text-center py-16">
          Nothing found — that concept hasn’t been added yet.
        </p>
      )}

      {grouped.map(([groupName, items]) => (
        <div key={groupName} className="mb-8">
          <h2 className="text-nav-muted text-xs font-bold uppercase tracking-[1.5px] mb-3">
            {groupName}
          </h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((c) => (
              <a
                key={c.slug}
                href={`${base}concepts/${c.slug}/`}
                className="group block bg-panel border border-line rounded-xl p-5 transition-all hover:-translate-y-0.5 hover:border-accent-line hover:shadow-[0_0_24px_rgba(124,108,255,.12)]"
              >
                <div className="font-semibold text-white text-[1.02rem] mb-1 group-hover:text-accent-ink">
                  {c.title}
                </div>
                <p className="text-sub text-[.85rem] leading-snug mb-3">{c.description}</p>
                <div className="flex flex-wrap gap-1.5 mb-3">
                  {c.tags.map((tag) => (
                    <span
                      key={tag}
                      className="text-[.7rem] text-accent-ink bg-accent-soft border border-accent-line rounded-full px-2 py-0.5"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
                <div className="text-[.75rem] text-sub">
                  {c.sections.length} sections · Updated {c.updated}
                </div>
              </a>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
