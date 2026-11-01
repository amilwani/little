"use client";

import { LANGUAGES, langInfo, type Lang } from "@/lib/languages";
import { Icon } from "./Icon";

export type { Lang };

/** English and Hindi one tap away; other Indian languages in a menu. */
export function LanguageToggle({ value, onChange }: { value: Lang; onChange: (l: Lang) => void }) {
  const quick: Lang[] = ["en-IN", "hi-IN"];
  const other = !quick.includes(value);
  const seg = (on: boolean) =>
    `rounded-md px-3 py-1 text-[13px] font-medium transition ${on ? "bg-card text-foreground shadow-sm" : "text-muted hover:text-foreground"}`;
  return (
    <div className="inline-flex max-w-full items-center self-start rounded-lg bg-subtle p-0.5" role="radiogroup" aria-label="Language">
      {quick.map((code) => (
        <button key={code} role="radio" aria-checked={value === code} onClick={() => onChange(code)} className={seg(value === code)}>
          {langInfo(code).native}
        </button>
      ))}
      <label className={`relative flex items-center gap-1 ${seg(other)}`}>
        <span className="max-w-[6.5rem] truncate">{other ? langInfo(value).native : "More"}</span>
        <Icon name="chevronDown" size={13} />
        <select
          aria-label="More languages"
          value={other ? value : ""}
          onChange={(e) => e.target.value && onChange(e.target.value as Lang)}
          className="absolute inset-0 w-full cursor-pointer opacity-0"
        >
          <option value="">More languages…</option>
          {LANGUAGES.filter((l) => !quick.includes(l.code)).map((l) => (
            <option key={l.code} value={l.code}>
              {l.native} · {l.name}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
