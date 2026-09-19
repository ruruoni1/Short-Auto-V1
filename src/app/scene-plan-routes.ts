import type { IncomingMessage, ServerResponse } from 'node:http';
import { z } from 'zod';
import { applyReviewedScenePlan } from '../scene-plan-adapter.js';
import { resolveAssets } from '../asset.js';
import type { Diagnostic } from '../validation.js';

type ReadBody = (req: IncomingMessage, limit?: number) => Promise<unknown>;
type SendJson = (res: ServerResponse, status: number, value: unknown) => void;

const RequestSchema = z.strictObject({ input: z.unknown(), handoff: z.unknown() });

function requestDiagnostics(error: unknown): Diagnostic[] {
  if (error instanceof z.ZodError) {
    return error.issues.map(issue => ({
      severity: 'error',
      code: 'SCENE_PLAN_REQUEST_SCHEMA',
      path: issue.path.join('.'),
      message: issue.message,
    }));
  }
  return [{ severity: 'error', code: 'SCENE_PLAN_REQUEST_INVALID', path: '', message: '요청 본문을 확인하세요.' }];
}

/** Local-only boundary for applying a reviewed planner handoff to Preview input. */
export function createScenePlanRoute() {
  return async (req: IncomingMessage, res: ServerResponse, path: string, method: string,
    body: ReadBody, json: SendJson): Promise<boolean> => {
    if (path !== '/api/auto-planner/preview-input') return false;
    if (method !== 'POST') return false;
    try {
      const request = RequestSchema.parse(await body(req));
      const result = applyReviewedScenePlan(request.input, request.handoff);
      if (!result.valid) {
        json(res, 400, { error: { code: 'SCENE_PLAN_INVALID', message: '검토 완료 장면 계획을 확인하세요.', diagnostics: result.diagnostics } });
        return true;
      }
      const assets = resolveAssets({ production: result.input.production, overrides: result.input.overrides });
      json(res, 200, {
        data: {
          input: result.input,
          diagnostics: result.diagnostics,
          assets: { plan: assets.valid ? assets.plan : null, diagnostics: assets.diagnostics },
        },
      });
      return true;
    } catch (error) {
      json(res, 400, { error: { code: 'SCENE_PLAN_INVALID', message: '검토 완료 장면 계획을 확인하세요.', diagnostics: requestDiagnostics(error) } });
      return true;
    }
  };
}
