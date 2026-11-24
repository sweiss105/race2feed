declare namespace Cloudflare {
  interface Env {
    HUB: DurableObjectNamespace<import('../src/hub').Hub>;
    ASSETS: Fetcher;
    ACCESS_TEAM_DOMAIN?: string;
    ACCESS_AUD?: string;
    EMERGENCY_PASSWORD?: string;
    DEV_CONSOLE_USER?: string;
  }
  interface Exports {
    default: Fetcher;
  }
}
