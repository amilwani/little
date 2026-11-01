import type { TranscriptSegment } from "@/lib/drive";
import { formatDuration } from "@/lib/recorder";

const SPEAKER_COLORS = ["#f07167", "#4d96ff", "#2a9d8f", "#9b5de5", "#e9a23b", "#ef476f"];

export function TranscriptView({
  segments,
  interim,
  onSeek,
  activeSec,
}: {
  segments: TranscriptSegment[];
  interim?: string;
  /** When set, tapping a line plays the recording from there. */
  onSeek?: (sec: number) => void;
  /** Current playback position, to highlight the line being played. */
  activeSec?: number;
}) {
  if (!segments.length && !interim) {
    return <p className="text-sm text-muted">The transcript will appear here as you talk.</p>;
  }
  const speakers = [...new Set(segments.map((s) => s.speaker).filter(Boolean))] as string[];
  const activeIndex =
    activeSec === undefined ? -1 : segments.findLastIndex((s) => s.startSec <= activeSec + 0.25);

  return (
    <div className="space-y-1">
      {segments.map((s, i) => {
        const showSpeaker = s.speaker && s.speaker !== segments[i - 1]?.speaker;
        const color = s.speaker ? SPEAKER_COLORS[speakers.indexOf(s.speaker) % SPEAKER_COLORS.length] : undefined;
        const body = (
          <>
            {showSpeaker && (
              <span className="mb-0.5 block text-xs font-semibold" style={{ color }}>
                {s.speaker}
              </span>
            )}
            <span className="mr-2 font-mono text-xs text-muted">{formatDuration(s.startSec * 1000)}</span>
            {s.text}
          </>
        );
        const cls = `block w-full rounded-lg px-2 py-1 text-left leading-relaxed ${showSpeaker && i ? "mt-2" : ""} ${
          i === activeIndex ? "bg-accent-soft" : ""
        }`;
        return onSeek ? (
          <button key={i} onClick={() => onSeek(s.startSec)} className={`${cls} hover:bg-accent-soft/60`} title="Play from here">
            {body}
          </button>
        ) : (
          <p key={i} className={cls}>
            {body}
          </p>
        );
      })}
      {interim && <p className="px-2 leading-relaxed text-muted">{interim}</p>}
    </div>
  );
}
