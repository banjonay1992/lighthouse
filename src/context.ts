// Builds everything a request or cron tick needs from the environment.

import { readConfig, type Config, type Env } from "./env";
import { Store } from "./db/store";
import { buildSender } from "./digest/send";
import type { JobContext } from "./jobs";
import { buildProviders } from "./providers/registry";
import type { FetchLike } from "./providers/types";

export interface AppContext extends JobContext {
  env: Env;
  config: Config;
  fetcher: FetchLike;
}

export function createContext(env: Env, now: Date, fetcher: FetchLike = (i, init) => fetch(i, init)): AppContext {
  const config = readConfig(env);
  return {
    env,
    config,
    fetcher,
    now,
    store: new Store(env.DB),
    providers: buildProviders(env, config, fetcher, () => now),
    sender: buildSender(env, config, fetcher),
  };
}
