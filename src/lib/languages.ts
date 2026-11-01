// Languages Little can listen in. Codes are BCP 47 tags, used by the browser's
// speech recognition and passed to the AI.

export const LANGUAGES = [
  { code: "en-IN", name: "English", native: "English", script: "Latin" },
  { code: "hi-IN", name: "Hindi", native: "हिंदी", script: "Devanagari" },
  { code: "mr-IN", name: "Marathi", native: "मराठी", script: "Devanagari" },
  { code: "bn-IN", name: "Bengali", native: "বাংলা", script: "Bengali" },
  { code: "ta-IN", name: "Tamil", native: "தமிழ்", script: "Tamil" },
  { code: "te-IN", name: "Telugu", native: "తెలుగు", script: "Telugu" },
  { code: "gu-IN", name: "Gujarati", native: "ગુજરાતી", script: "Gujarati" },
  { code: "kn-IN", name: "Kannada", native: "ಕನ್ನಡ", script: "Kannada" },
  { code: "ml-IN", name: "Malayalam", native: "മലയാളം", script: "Malayalam" },
  { code: "pa-IN", name: "Punjabi", native: "ਪੰਜਾਬੀ", script: "Gurmukhi" },
  { code: "ur-IN", name: "Urdu", native: "اردو", script: "Urdu (Nastaliq)" },
] as const;

export type Lang = (typeof LANGUAGES)[number]["code"];

export function langInfo(code: string) {
  return LANGUAGES.find((l) => l.code === code) ?? LANGUAGES[0];
}

/** "Hindi (हिंदी, written in Devanagari)": what the AI is told. */
export function languageForAi(code: string) {
  const l = langInfo(code);
  return l.code === "en-IN" ? "English" : `${l.name} (write it in ${l.script} script; keep English words as spoken)`;
}
