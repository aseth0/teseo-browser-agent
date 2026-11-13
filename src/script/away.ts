// The background runs a custom tool's script itself, in the script engine (script/quickjs): its requests
// are done with the tool's access (script/request), its tool() and note() by the caller (steps).
import { limit } from '../core/limits';
import { scriptRequest, type ScriptAccess } from './request';
import { runScript, type ScriptRun, type ScriptSteps } from './quickjs';

export function runScriptAway(access: ScriptAccess, code: string, input: Record<string, unknown>, signal: AbortSignal, steps?: ScriptSteps): Promise<ScriptRun> {
  const request = (method: string, path: string, body: unknown) => {
    if (!access.url) return Promise.reject(new Error('This script has no site: it can only call its tools.'));
    return scriptRequest(access, method, path, body, signal);
  };
  // Its time: Settings → Limits (one that calls tools, its steps' own).
  return runScript({ code, input, request, signal, timeMs: limit('scriptTime') * 1000, ...(steps && { steps }) });
}
