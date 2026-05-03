import { buildApp } from './server.js';
import { assertProductionSecrets, env } from './env.js';
import { logger } from './lib/logger.js';
import { prisma } from './db.js';
import { closeQueues, ensureSesQuotaPollScheduled, ensureAudienceComputeScheduled } from './lib/queue.js';

assertProductionSecrets();

const app = buildApp();
const server = app.listen(env.PORT, () => {
  logger.info({ port: env.PORT, env: env.NODE_ENV }, 'Pipelineflow Engagement API listening');
});

// SES quota poller. BullMQ dedupes repeatables by jobId, so multi-instance
// api deployments converge on a single schedule.
void ensureSesQuotaPollScheduled().catch((err) => {
  logger.error({ err }, 'failed to register ses-quota-poll schedule');
});

// Re-register per-audience compute schedules. Audiences created during a
// Redis flush would otherwise stop computing until edited.
void (async () => {
  try {
    const audiences = await prisma.audience.findMany({
      where: { status: 'active' },
      select: { id: true, computeIntervalSeconds: true },
    });
    for (const a of audiences) {
      await ensureAudienceComputeScheduled(a.id, a.computeIntervalSeconds);
    }
  } catch (err) {
    logger.error({ err }, 'failed to register audience compute schedules');
  }
})();

let shuttingDown = false;
const shutdown = (signal: string) => {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'shutting down');
  server.close(async (err) => {
    if (err) logger.error({ err }, 'error during server.close');
    try { await closeQueues(); } catch (e) { logger.error({ err: e }, 'error closing queues'); }
    try { await prisma.$disconnect(); } catch (e) { logger.error({ err: e }, 'error disconnecting prisma'); }
    process.exit(err ? 1 : 0);
  });
  setTimeout(() => {
    logger.warn('forced exit after 15s grace');
    process.exit(1);
  }, 15_000).unref();
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('unhandledRejection', (reason) => {
  logger.error({ reason }, 'unhandledRejection');
});
