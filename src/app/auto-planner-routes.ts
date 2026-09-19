import type { IncomingMessage, ServerResponse } from 'node:http';
import { planScenes } from '../auto-planner.js';

type ReadBody = (req: IncomingMessage, limit?: number) => Promise<unknown>;
type SendJson = (res: ServerResponse, status: number, value: unknown) => void;

/** Local-only HTTP adapter for the deterministic AutoPlanner core function. */
export function createAutoPlannerRoute() {
  return async (req: IncomingMessage, res: ServerResponse, path: string, method: string,
    body: ReadBody, json: SendJson): Promise<boolean> => {
    if (path !== '/api/auto-planner/plan') return false;
    if (method !== 'POST') return false;
    const result = planScenes(await body(req) as { source: unknown; assets?: unknown; existingScenes?: unknown });
    if (!result.valid) {
      json(res, 400, { error: { code: 'PLANNER_INVALID', message: 'AutoPlanner 입력을 확인하세요.', diagnostics: result.diagnostics } });
      return true;
    }
    json(res, 200, { data: { scenes: result.scenes, diagnostics: result.diagnostics } });
    return true;
  };
}
