import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ThumbnailRepository } from '../thumbnails/repository.js';
import type { ContentPlanRepository } from './repository.js';

type ReadBody = (req: IncomingMessage, limit?: number) => Promise<unknown>;
type SendJson = (res: ServerResponse, status: number, value: unknown) => void;

export function createContentPlanRoute(
  plans: ContentPlanRepository,
  thumbnails: Pick<ThumbnailRepository, 'listProjects'>,
) {
  const representation = (contentId: string) => {
    const plan = plans.getContentPlan(contentId);
    return {
      data: {
        ...plan,
        thumbnailProjects: thumbnails.listProjects().filter(project => project.contentId === contentId),
      },
      meta: { warnings: plans.warningsFor(plan) },
    };
  };

  return async (req: IncomingMessage, res: ServerResponse, path: string, method: string,
    body: ReadBody, json: SendJson): Promise<boolean> => {
    if (path === '/api/content-plans') {
      if (method === 'GET') {
        const projects = thumbnails.listProjects();
        const storedPlans = plans.listContentPlans();
        json(res, 200, { data: storedPlans.map(plan => ({
          ...plan,
          thumbnailProjects: projects.filter(project => project.contentId === plan.contentId),
        })), meta: { warnings: storedPlans.flatMap(plan => plans.warningsFor(plan).map(warning => ({
          contentId: plan.contentId,
          ...warning,
        }))) } });
        return true;
      }
      if (method === 'POST') {
        const created = plans.createContentPlan(await body(req));
        json(res, 201, representation(created.contentId));
        return true;
      }
    }
    const match = path.match(/^\/api\/content-plans\/([^/]+)$/);
    if (!match) return false;
    if (method === 'GET') {
      json(res, 200, representation(match[1]!));
      return true;
    }
    if (method === 'PATCH') {
      const updated = plans.updateContentPlan(match[1]!, await body(req));
      json(res, 200, representation(updated.contentId));
      return true;
    }
    return false;
  };
}
