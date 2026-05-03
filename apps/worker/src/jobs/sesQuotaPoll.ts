import type { Job } from 'bullmq';
import { pollSesQuota } from '../integrations/ses/quota.js';
import { logger } from '../logger.js';

export async function processSesQuotaPoll(_job: Job) {
  try {
    await pollSesQuota();
  } catch (err) {
    // Don't blow up — SES might be misconfigured pre-bootstrap. The poller
    // re-runs every 60s, so a transient error is fine.
    logger.warn({ err }, 'ses quota poll failed');
  }
}
