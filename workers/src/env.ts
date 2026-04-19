export interface Env {
  DB: D1Database;
  FIT_BUCKET: R2Bucket;
  EMAIL: SendEmail;
  SESSION_SECRET: string;
  APP_URL: string;
  MAGIC_FROM: string;
  MAGIC_FROM_NAME: string;
  MAGIC_TTL_SECONDS: string;
  SESSION_TTL_SECONDS: string;
  COOKIE_DOMAIN: string;
  DEV_RETURN_MAGIC_LINK: string;
}

// Cloudflare Email Service send_email binding.
// The runtime exposes .send({ to, from, subject, html, text }).
export interface SendEmail {
  send(message: {
    to: string | string[];
    from: string | { email: string; name?: string };
    subject: string;
    html?: string;
    text?: string;
    replyTo?: string;
  }): Promise<void>;
}
