// Placeholder drawing of Little, the app's mascot. To be replaced with the
// final AI-generated character art.

type Props = {
  size?: number;
  mood?: "happy" | "listening" | "sleepy";
  className?: string;
};

export function Mascot({ size = 96, mood = "happy", className }: Props) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 120 120"
      role="img"
      aria-label="Little, the app mascot"
      className={className}
    >
      {/* buns */}
      <circle cx="26" cy="30" r="14" fill="#3b2a26" />
      <circle cx="94" cy="30" r="14" fill="#3b2a26" />
      <circle cx="26" cy="30" r="5" fill="#f28482" />
      <circle cx="94" cy="30" r="5" fill="#f28482" />
      {/* hair back */}
      <path d="M18 66c0-30 18-46 42-46s42 16 42 46v18H18z" fill="#3b2a26" />
      {/* face */}
      <ellipse cx="60" cy="68" rx="34" ry="33" fill="#ffd9c2" />
      {/* bangs */}
      <path d="M26 58c4-20 18-30 34-30s30 10 34 30c-10-6-18-14-22-20-6 10-22 18-46 20z" fill="#3b2a26" />
      {/* eyes */}
      {mood === "sleepy" ? (
        <>
          <path d="M40 70q6 4 12 0" stroke="#3b2a26" strokeWidth="3" fill="none" strokeLinecap="round" />
          <path d="M68 70q6 4 12 0" stroke="#3b2a26" strokeWidth="3" fill="none" strokeLinecap="round" />
        </>
      ) : (
        <>
          <ellipse cx="46" cy="70" rx="4.5" ry="5.5" fill="#3b2a26" />
          <ellipse cx="74" cy="70" rx="4.5" ry="5.5" fill="#3b2a26" />
          <circle cx="47.5" cy="68" r="1.6" fill="#fff" />
          <circle cx="75.5" cy="68" r="1.6" fill="#fff" />
        </>
      )}
      {/* cheeks */}
      <ellipse cx="36" cy="82" rx="6" ry="3.5" fill="#f4978e" opacity="0.7" />
      <ellipse cx="84" cy="82" rx="6" ry="3.5" fill="#f4978e" opacity="0.7" />
      {/* mouth */}
      {mood === "listening" ? (
        <ellipse cx="60" cy="88" rx="4" ry="5" fill="#c9505a" />
      ) : (
        <path d="M52 86q8 8 16 0" stroke="#c9505a" strokeWidth="3" fill="none" strokeLinecap="round" />
      )}
      {mood === "listening" && (
        <g stroke="#f28482" strokeWidth="3" fill="none" strokeLinecap="round">
          <path d="M104 62q6 8 0 16" />
          <path d="M111 56q10 14 0 28" />
        </g>
      )}
    </svg>
  );
}
