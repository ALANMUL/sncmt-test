'use client';
import { ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

export function PageHeader({
  title,
  crumbs,
  action,
}: {
  title: string;
  crumbs?: string[];
  action?: React.ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 className="font-display text-3xl font-semibold">{title}</h1>
        {crumbs && (
          <p className="mt-1 flex items-center gap-1 text-sm text-ink/60">
            {crumbs.map((c, i) => (
              <span key={c} className="flex items-center gap-1">
                {i > 0 && <ChevronRight size={14} />}
                <span className={i === crumbs.length - 1 ? 'text-field' : ''}>{c}</span>
              </span>
            ))}
          </p>
        )}
      </div>
      {action}
    </div>
  );
}

export function Tabs({
  tabs,
  active,
  onChange,
}: {
  tabs: string[];
  active: string;
  onChange: (tab: string) => void;
}) {
  return (
    <div role="tablist" className="flex flex-wrap gap-1 rounded-lg bg-white p-1 ring-1 ring-line">
      {tabs.map((t) => (
        <button
          key={t}
          role="tab"
          aria-selected={active === t}
          onClick={() => onChange(t)}
          className={cn(
            'rounded-md px-4 py-2 text-sm font-medium',
            active === t ? 'bg-field text-white' : 'text-ink/70 hover:bg-paper',
          )}
        >
          {t}
        </button>
      ))}
    </div>
  );
}