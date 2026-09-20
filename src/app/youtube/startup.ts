import type { Publisher, PublishingMetadata } from '../../models.js';
import { YouTubePublishingBoundary, type PublishingAttempt, type PublishingDependencies } from './publishing.js';
import { createYouTubePublishingRoute } from './routes.js';

export interface PublishingApprovalProvider {
  /** Return an authenticated publisher only after explicit operational approval. */
  approve(metadata: PublishingMetadata): Promise<Publisher | null>;
}

type ReviewDependencies = Omit<PublishingDependencies, 'publisher'>;

/** Startup wiring. No provider means attempts remain local and blocked. */
export function createStartupYouTubePublishingRoute(
  dependencies: ReviewDependencies,
  approvalProvider?: PublishingApprovalProvider,
) {
  const boundary = new YouTubePublishingBoundary(dependencies);
  return createYouTubePublishingRoute({
    review: input => boundary.review(input),
    async publish(input): Promise<PublishingAttempt> {
      const review = await boundary.review(input);
      if (review.status === 'blocked' || !review.metadata) {
        return { status: 'blocked', diagnostics: review.diagnostics };
      }
      if (!approvalProvider) return boundary.publish(input);

      let publisher: Publisher | null = null;
      try {
        const approved = await approvalProvider.approve(review.metadata);
        if (approved && typeof approved.publish === 'function') publisher = approved;
      } catch { /* Provider failures are reported without exposing their details. */ }
      if (!publisher) {
        return {
          status: 'blocked',
          diagnostics: [{ severity: 'error', code: 'PUBLISHING_APPROVAL_REQUIRED', path: 'approval', message: 'Publishing approval is unavailable.' }],
        };
      }
      // The boundary rechecks live workspace, rights, and file evidence after approval.
      return new YouTubePublishingBoundary({ ...dependencies, publisher }).publish(input);
    },
  });
}
