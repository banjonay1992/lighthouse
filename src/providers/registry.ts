// Builds the provider set from the environment. In demo mode every provider
// is a fake. Otherwise each live provider is only created when its
// credentials are present, so a half-configured install still works.

import type { Config, Env } from "../env";
import { AppStoreConnectClient, AppStoreProvider } from "./appstore";
import {
  DemoSigningProvider,
  DemoStoreProvider,
  DemoSupabaseProvider,
  DemoTlsProvider,
  DemoUptimeProvider,
} from "./demo";
import { GoogleAuth, GooglePlayProvider, parseServiceAccount } from "./googleplay";
import { SupabaseManagementProvider } from "./supabase";
import { CertificateTransparencyProvider } from "./tls";
import type { FetchLike, Providers } from "./types";
import { HttpUptimeProvider } from "./uptime";

export interface ProviderStatus {
  appstore: boolean;
  googleplay: boolean;
  supabase: boolean;
  tls: boolean;
  uptime: true;
}

export function providerStatus(env: Env, config: Config): ProviderStatus {
  if (config.demo) return { appstore: true, googleplay: true, supabase: true, tls: true, uptime: true };
  return {
    appstore: Boolean(env.ASC_ISSUER_ID && env.ASC_KEY_ID && env.ASC_PRIVATE_KEY),
    googleplay: Boolean(env.GOOGLE_PLAY_SERVICE_ACCOUNT),
    supabase: Boolean(env.SUPABASE_ACCESS_TOKEN),
    tls: config.tlsSource !== "off",
    uptime: true,
  };
}

export function buildProviders(
  env: Env,
  config: Config,
  fetcher: FetchLike = (input, init) => fetch(input, init),
  now: () => Date = () => new Date(),
): Providers {
  if (config.demo) {
    return {
      stores: [new DemoStoreProvider("appstore", now), new DemoStoreProvider("googleplay", now)],
      signing: new DemoSigningProvider(now),
      uptime: new DemoUptimeProvider(now),
      tls: new DemoTlsProvider(now),
      supabase: new DemoSupabaseProvider(),
    };
  }

  const status = providerStatus(env, config);
  const providers: Providers = {
    stores: [],
    signing: null,
    uptime: new HttpUptimeProvider(fetcher),
    tls: status.tls ? new CertificateTransparencyProvider(fetcher, now) : null,
    supabase: status.supabase ? new SupabaseManagementProvider(env.SUPABASE_ACCESS_TOKEN!, fetcher, { includeDatabaseSize: config.supabaseDbSize }) : null,
  };

  if (status.appstore) {
    const client = new AppStoreConnectClient(
      { issuerId: env.ASC_ISSUER_ID!, keyId: env.ASC_KEY_ID!, privateKey: env.ASC_PRIVATE_KEY! },
      fetcher,
      now,
    );
    const appstore = new AppStoreProvider(client);
    providers.stores.push(appstore);
    providers.signing = appstore;
  }

  if (status.googleplay) {
    const account = parseServiceAccount(env.GOOGLE_PLAY_SERVICE_ACCOUNT!);
    providers.stores.push(new GooglePlayProvider(new GoogleAuth(account, fetcher, now), fetcher));
  }

  return providers;
}
