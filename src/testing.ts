import type { RunScript } from "./osascript.ts";

export function recordingRun(output = ""): { run: RunScript; scripts: string[] } {
  const scripts: string[] = [];
  const run: RunScript = async (script) => {
    scripts.push(script);
    return output;
  };
  return { run, scripts };
}
