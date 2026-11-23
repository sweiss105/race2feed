declare namespace Cloudflare {
  interface Env {
    HUB: DurableObjectNamespace<import('../src/hub').Hub>;
    ADMIN_PASSWORD: string;
  }
  interface Exports {
    default: Fetcher;
  }
}
