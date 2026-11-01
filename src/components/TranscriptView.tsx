import type { TranscriptSegment } from "@/lib/drive";
import { formatDuration } from "@/lib/recorder";

export function TranscriptView({ segments, interim }: { segments: TranscriptSegment[]; interim?: string }) {
  if (!segments.length && !interim) {
    return <p className="text-sm text-muted">The transcript will appear here as you talk.</p>;
  }
  return (
    <div className="space-y-3">
      {segments.map((s, i) => (
        <p key={i} className="leading-relaxed">
          <span className="mr-2 font-mono text-xs text-muted">{formatDuration(s.startSec * 1000)}</span>
          {s.text}
        </p>
      ))}
      {interim && <p className="leading-relaxed text-muted">{interim}</p>}
    </div>
  );
}
