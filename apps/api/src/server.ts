import express from 'express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import cors from 'cors';
import { pinoHttp } from 'pino-http';
import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { ExpressAdapter } from '@bull-board/express';
import { env } from './env.js';
import { logger } from './lib/logger.js';
import { errorHandler, notFound } from './lib/error.js';
import { attachUser, originGuard, requireAuth } from './auth/middleware.js';
import { allQueues, redisConnection } from './lib/queue.js';
import { authRouter } from './routes/auth.js';
import { profileRouter } from './routes/profile.js';
import { subscribersRouter } from './routes/subscribers.js';
import { audiencesRouter } from './routes/audiences.js';
import { templatesRouter } from './routes/templates.js';
import { broadcastsRouter } from './routes/broadcasts.js';
import { journeysRouter } from './routes/journeys.js';
import { subscriptionGroupsRouter } from './routes/subscriptionGroups.js';
import { suppressionsRouter } from './routes/suppressions.js';
import { secretsRouter } from './routes/secrets.js';
import { apiTokensRouter } from './routes/apiTokens.js';
import { deliveriesRouter } from './routes/deliveries.js';
import { dashboardRouter } from './routes/dashboard.js';
import { adminRouter } from './routes/admin.js';
import { trackRouter } from './routes/public/track.js';
import { sesWebhookRouter } from './routes/public/sesWebhook.js';
import { crmWebhookRouter } from './routes/public/crmWebhook.js';
import { preferencesRouter } from './routes/public/preferences.js';

export function buildApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:', 'blob:', 'https:'],
          connectSrc: ["'self'"],
          fontSrc: ["'self'", 'data:'],
          objectSrc: ["'none'"],
          frameAncestors: ["'none'"],
          formAction: ["'self'"],
          baseUri: ["'self'"],
        },
      },
      crossOriginEmbedderPolicy: false,
    }),
  );

  app.use(cors({ origin: env.APP_ORIGIN, credentials: true }));

  // Webhooks need the raw body for signature verification — mount per-route
  // before the global JSON parser so we can re-verify against the exact bytes
  // we received.
  app.use('/api/public/webhooks', express.raw({ type: '*/*', limit: '2mb' }));

  app.use(express.json({ limit: '2mb' }));
  app.use(cookieParser());
  app.use(pinoHttp({ logger }));

  app.get('/healthz', (_req, res) => {
    const redisReady = redisConnection.status === 'ready';
    if (!redisReady) {
      res.status(503).json({ status: 'degraded', redis: redisConnection.status });
      return;
    }
    res.json({ status: 'ok', redis: redisConnection.status });
  });

  app.use(originGuard);
  app.use(attachUser);

  // ── Authenticated routes ────────────────────────────────────────────────
  app.use('/api/auth', authRouter);
  app.use('/api/profile', profileRouter);
  app.use('/api/subscribers', subscribersRouter);
  app.use('/api/audiences', audiencesRouter);
  app.use('/api/templates', templatesRouter);
  app.use('/api/broadcasts', broadcastsRouter);
  app.use('/api/journeys', journeysRouter);
  app.use('/api/subscription-groups', subscriptionGroupsRouter);
  app.use('/api/suppressions', suppressionsRouter);
  app.use('/api/secrets', secretsRouter);
  app.use('/api/api-tokens', apiTokensRouter);
  app.use('/api/deliveries', deliveriesRouter);
  app.use('/api/dashboard', dashboardRouter);
  app.use('/api/admin', adminRouter);

  // ── Public routes (token / signature / cookie-free) ─────────────────────
  app.use('/api/public', trackRouter);
  app.use('/api/public/webhooks', sesWebhookRouter);
  app.use('/api/public/webhooks', crmWebhookRouter);
  app.use('/p/preferences', preferencesRouter);

  if (env.BULL_BOARD_ENABLED) {
    const serverAdapter = new ExpressAdapter();
    serverAdapter.setBasePath('/admin/queues');
    createBullBoard({
      queues: allQueues.map((q) => new BullMQAdapter(q)),
      serverAdapter,
    });
    app.use(
      '/admin/queues',
      requireAuth,
      helmet.contentSecurityPolicy({
        useDefaults: false,
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'", "'unsafe-inline'"],
          styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
          fontSrc: ["'self'", 'data:', 'https://fonts.gstatic.com'],
          imgSrc: ["'self'", 'data:'],
          connectSrc: ["'self'"],
        },
      }),
      serverAdapter.getRouter(),
    );
  }

  app.use(notFound);
  app.use(errorHandler);
  return app;
}
