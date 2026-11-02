import { afterEach, describe, expect, it, vi } from "vitest";

// next.config.mjs sets the security headers of the site. The policy depends on NODE_ENV, so each case loads the file again.
afterEach(() => vi.unstubAllEnvs());

async function load(nodeEnv: string) {
  vi.stubEnv("NODE_ENV", nodeEnv);
  vi.resetModules();
  const { default: config } = await import("../next.config.mjs");
  const rules = await config.headers();
  expect(rules).toHaveLength(1);
  expect(rules[0].source).toBe("/:path*"); // every page
  return { config, headers: Object.fromEntries(rules[0].headers.map((h) => [h.key, h.value])) };
}

describe("security headers", () => {
  for (const env of ["development", "production"]) {
    it(`${env}: the basic headers are always there`, async () => {
      const { headers } = await load(env);
      expect(headers["X-Content-Type-Options"]).toBe("nosniff");
      expect(headers["X-Frame-Options"]).toBe("DENY");
      expect(headers["Referrer-Policy"]).toBe("strict-origin-when-cross-origin");
      for (const feature of ["camera", "microphone", "geolocation", "payment", "usb"]) expect(headers["Permissions-Policy"]).toContain(`${feature}=()`);
    });
  }

  it("development: no Content-Security-Policy and no HSTS (they would break live reload and http://localhost)", async () => {
    const { headers } = await load("development");
    expect(headers["Content-Security-Policy"]).toBeUndefined();
    expect(headers["Strict-Transport-Security"]).toBeUndefined();
  });

  it("production: a strict Content-Security-Policy and HSTS", async () => {
    const { headers } = await load("production");
    const csp = headers["Content-Security-Policy"];
    expect(csp).toBeDefined();
    const directives = Object.fromEntries(csp.split(";").map((d) => d.trim().split(/\s+/)).map(([name, ...values]) => [name, values]));
    expect(directives["default-src"]).toEqual(["'self'"]);
    expect(directives["object-src"]).toEqual(["'none'"]);
    expect(directives["frame-ancestors"]).toEqual(["'none'"]);
    expect(directives["base-uri"]).toEqual(["'self'"]);
    expect(directives["form-action"]).toEqual(["'self'"]);
    expect(directives["connect-src"]).toEqual(["'self'"]);
    expect(csp).not.toContain("unsafe-eval");
    expect(csp).not.toMatch(/\s\*(\s|;|$)/); // no wildcard source
    // the only other websites the pages may load anything from: Google Fonts
    const hosts = [...csp.matchAll(/https?:\/\/[^\s;]+/g)].map((m) => m[0]).sort();
    expect(hosts).toEqual(["https://fonts.googleapis.com", "https://fonts.gstatic.com"]);
    expect(headers["Strict-Transport-Security"]).toMatch(/^max-age=\d+$/);
  });

  it("does not announce the framework and keeps the 6 MB limit for the logo upload", async () => {
    const { config } = await load("production");
    expect(config.poweredByHeader).toBe(false);
    expect(config.experimental?.serverActions?.bodySizeLimit).toBe("6mb");
  });
});
