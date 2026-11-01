"use client";

export type Lang = "en-IN" | "hi-IN";

export function LanguageToggle({ value, onChange }: { value: Lang; onChange: (l: Lang) => void }) {
  const opts: { id: Lang; label: string }[] = [
    { id: "en-IN", label: "English" },
    { id: "hi-IN", label: "हिंदी" },
  ];
  return (
    <div className="inline-flex rounded-full border border-border bg-card p-1" role="radiogroup" aria-label="Language">
      {opts.map((o) => (
        <button
          key={o.id}
          role="radio"
          aria-checked={value === o.id}
          onClick={() => onChange(o.id)}
          className={`rounded-full px-4 py-1.5 text-sm font-medium transition ${
            value === o.id ? "bg-accent text-white" : "text-muted"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
