import type { RunScript, ScriptLanguage } from "./osascript.ts";

export function recordingRun(output = ""): {
  run: RunScript;
  scripts: string[];
  languages: (ScriptLanguage | undefined)[];
} {
  const scripts: string[] = [];
  const languages: (ScriptLanguage | undefined)[] = [];
  const run: RunScript = async (script, _timeoutMs, language) => {
    scripts.push(script);
    languages.push(language);
    return output;
  };
  return { run, scripts, languages };
}
