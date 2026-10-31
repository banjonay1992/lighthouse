// Lighthouse Worker entry point.
//   fetch:     /api/* goes to the JSON API; everything else is static assets.
//   scheduled: the five-minute cron runs whichever jobs are due.

import { handleApi } from "./api/routes";
import { createContext } from "./context";
import { seedDemo } from "./demo/seed";
import type { Env } from "./env";
import { runScheduledTick } from "./jobs";

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) {
      return handleApi(request, createContext(env, new Date()));
    }
    if (env.ASSETS) return env.ASSETS.fetch(request);
    return new Response("Not found", { status: 404 });
  },

  async scheduled(controller, env): Promise<void> {
    const ctx = createContext(env, new Date(controller.scheduledTime));
    if (ctx.config.demo) await seedDemo(ctx);
    const outcomes = await runScheduledTick(ctx);
    for (const o of outcomes) {
      if (o.ok) console.log(`[${o.job}] ${o.summary}`);
      else console.error(`[${o.job}] failed: ${o.error}`);
    }
  },
} satisfies ExportedHandler<Env>;
