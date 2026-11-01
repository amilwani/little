"use client";

import { LANGUAGES, langInfo, type Lang } from "@/lib/languages";

export type { Lang };

/** English and Hindi one tap away; other Indian languages in a menu. */
export function LanguageToggle({ value, onChange }: { value: Lang; onChange: (l: Lang) => void }) {
  const quick: Lang[] = ["en-IN", "hi-IN"];
  const other = !quick.includes(value);
  return (
    <div className="inline-flex items-center rounded-full border border-border bg-card p-1" role="radiogroup" aria-label="Language">
      {quick.map((code) => (
        <button
          key={code}
          role="radio"
          aria-checked={value === code}
          onClick={() => onChange(code)}
          className={`rounded-full px-4 py-1.5 text-sm font-medium transition ${value === code ? "bg-accent text-white" : "text-muted"}`}
        >
          {langInfo(code).native}
        </button>
      ))}
      <select
        aria-label="More languages"
        value={other ? value : ""}
        onChange={(e) => e.target.value && onChange(e.target.value as Lang)}
        className={`rounded-full px-3 py-1.5 text-sm font-medium outline-none ${other ? "bg-accent text-white" : "bg-transparent text-muted"}`}
      >
        <option value="">More…</option>
        {LANGUAGES.filter((l) => !quick.includes(l.code)).map((l) => (
          <option key={l.code} value={l.code}>
            {l.native} · {l.name}
          </option>
        ))}
      </select>
    </div>
  );
}
