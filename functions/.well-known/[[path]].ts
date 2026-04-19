import worker from "../../workers/src/index";
import type { Env } from "../../workers/src/env";

export const onRequest: PagesFunction<Env> = (ctx) =>
  worker.fetch(ctx.request, ctx.env);
