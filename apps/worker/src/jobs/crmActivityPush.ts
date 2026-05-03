// Phase 1 stub. Phase 2 will fan out delivery lifecycle events to the CRM's
// engagement-activity endpoint. We define the worker now so Phase 1 docker-
// compose mounts the queue + bull-board surface; processor is a no-op until
// Delivery lifecycle fan-out lands.

import type { Job } from 'bullmq';
import type { CrmActivityPushJobData } from '@pipelineflow-engagement/shared';
import { logger } from '../logger.js';

export async function processCrmActivityPush(_job: Job<CrmActivityPushJobData>) {
  logger.debug('crm-activity-push: phase 2; ignoring for now');
}
