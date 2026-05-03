// SES sendMail. Composes a raw MIME message via nodemailer's MailComposer
// (so we can inject custom headers like List-Unsubscribe / List-Unsubscribe-Post
// that SES Simple sends can't carry) and dispatches via SESv2
// SendEmailCommand. Tags the send with delivery_id + broadcast_id so the
// SNS notification handler can correlate webhook events back to
// Delivery rows via providerMessageId.

import { createRequire } from 'node:module';
import { SendEmailCommand, getSesClient } from './client.js';
import { logger } from '../../logger.js';

// nodemailer's MailComposer is exposed only via deep CJS path. createRequire
// gives ESM modules a real CJS require so we can pull it in cleanly.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const require = createRequire(import.meta.url);
const MailComposer = require('nodemailer/lib/mail-composer') as new (
  opts: object,
) => { compile: () => { build: (cb: (err: Error | null, msg: Buffer) => void) => void } };

export interface SendMailInput {
  toEmail: string;
  fromEmail: string;
  fromName: string;
  replyTo?: string | null;
  subject: string;
  html: string;
  text: string;
  headers?: Record<string, string>;
  // SES MessageTags. AWS limits: 50 tags, ASCII keys/values, 256 chars each.
  tags?: Record<string, string>;
}

export interface SendMailResult {
  providerMessageId: string;
}

function quoteName(name: string): string {
  if (/[(),:;<>@\[\]"\\]/.test(name)) {
    return `"${name.replace(/(["\\])/g, '\\$1')}"`;
  }
  return name;
}

function buildRawMessage(input: SendMailInput): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const fromHeader = input.fromName
      ? `${quoteName(input.fromName)} <${input.fromEmail}>`
      : input.fromEmail;
    const composer = new MailComposer({
      from: fromHeader,
      to: input.toEmail,
      replyTo: input.replyTo ?? undefined,
      subject: input.subject,
      text: input.text,
      html: input.html,
      headers: input.headers,
    });
    composer.compile().build((err, msg) => {
      if (err) reject(err);
      else resolve(msg);
    });
  });
}

export async function sendMail(input: SendMailInput): Promise<SendMailResult> {
  const ses = await getSesClient();
  if (!ses) {
    throw new Error('AWS SES is not configured. Set the amazon-ses secret in the API.');
  }
  const raw = await buildRawMessage(input);

  const tags = Object.entries(input.tags ?? {}).map(([Name, Value]) => ({
    Name,
    Value,
  }));

  const cmd = new SendEmailCommand({
    Content: { Raw: { Data: raw } },
    EmailTags: tags.length ? tags : undefined,
  });
  const out = await ses.client.send(cmd);
  if (!out.MessageId) {
    throw new Error('SES did not return a MessageId');
  }
  logger.debug({ messageId: out.MessageId, to: input.toEmail }, 'SES send ok');
  return { providerMessageId: out.MessageId };
}
