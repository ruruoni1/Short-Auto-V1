import type { AppRoute } from '../server.js';
import type { YouTubePublishingBoundary } from './publishing.js';

type PublishingBoundary = Pick<YouTubePublishingBoundary, 'review' | 'publish'>;

export function createYouTubePublishingRoute(boundary: PublishingBoundary): AppRoute {
  return async (req, res, path, method, readBody, json) => {
    if (method !== 'POST') return false;

    if (path === '/api/youtube/publishing/attempt') {
      const attempt = await boundary.publish(await readBody(req));
      if (attempt.status === 'uploaded') {
        json(res, 200, { data: { status: attempt.status, result: attempt.result } });
        return true;
      }

      if (attempt.status === 'blocked') {
        json(res, 409, {
          error: {
            code: 'YOUTUBE_PUBLISHING_BLOCKED',
            message: '게시 전 검수에 실패했습니다.',
            diagnostics: attempt.diagnostics,
          },
        });
        return true;
      }

      json(res, 502, {
        error: {
          code: 'YOUTUBE_PUBLISHING_FAILED',
          message: '게시에 실패했습니다.',
          diagnostics: attempt.diagnostics,
          result: attempt.result,
        },
      });
      return true;
    }

    if (path !== '/api/youtube/publishing/review') return false;

    const review = await boundary.review(await readBody(req));
    if (review.status === 'ready') {
      json(res, 200, {
        data: {
          status: review.status,
          diagnostics: review.diagnostics,
          metadata: review.metadata,
        },
      });
      return true;
    }

    json(res, 409, {
      error: {
        code: 'YOUTUBE_PUBLISHING_BLOCKED',
        message: '게시 전 검수에 실패했습니다.',
        diagnostics: review.diagnostics,
      },
    });
    return true;
  };
}
