export interface Env {
  DB: D1Database;
  FIT_BUCKET: R2Bucket;
  EMAIL_SVC: Fetcher;
  SESSION_SECRET: string;
  APP_URL: string;
  MAGIC_FROM: string;
  MAGIC_FROM_NAME: string;
  MAGIC_TTL_SECONDS: string;
  SESSION_TTL_SECONDS: string;
  COOKIE_DOMAIN: string;
  DEV_RETURN_MAGIC_LINK: string;
}
