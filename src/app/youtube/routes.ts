import type { AppRoute } from '../server.js';
import type { YouTubePublishingBoundary } from './publishing.js';

type PublishingReviewBoundary = Pick<YouTubePublishingBoundary, 'review'>;

export function createYouTubePublishingRoute(boundary: PublishingReviewBoundary): AppRoute {
  return async (req, res, path, method, readBody, json) => {
    if (method !== 'POST' || path !== '/api/youtube/publishing/review') return false;

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
