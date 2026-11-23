declare namespace Cloudflare {
  interface Env {
    HUB: DurableObjectNamespace<import('../src/hub').Hub>;
    ASSETS: Fetcher;
    ADMIN_PASSWORD: string;
  }
  interface Exports {
    default: Fetcher;
  }
}
