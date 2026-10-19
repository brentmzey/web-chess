import { describe, expect, it } from 'bun:test';

describe('Deployed client security headers (netlify.toml)', async () => {
  const toml = await Bun.file(new URL('../netlify.toml', import.meta.url)).text();
  const csp = toml.match(/Content-Security-Policy = "([^"]+)"/)?.[1] ?? '';
  const directive = (name: string): string =>
    csp
      .split(';')
      .map(d => d.trim())
      .find(d => d.startsWith(`${name} `)) ?? '';

  it('forbids inline and eval scripts', () => {
    expect(directive('script-src')).toBe("script-src 'self'");
    expect(csp).not.toContain('unsafe-eval');
  });

  it('locks down plugins, base URI, forms, framing, and mixed content', () => {
    expect(directive('object-src')).toBe("object-src 'none'");
    expect(directive('base-uri')).toBe("base-uri 'self'");
    expect(directive('form-action')).toBe("form-action 'self'");
    expect(directive('frame-ancestors')).toBe("frame-ancestors 'none'");
    expect(directive('connect-src')).toBe("connect-src 'self'");
    expect(csp).toContain('upgrade-insecure-requests');
    expect(directive('img-src')).not.toContain('https:');
  });

  it('sets cross-origin isolation, HSTS, and framing headers', () => {
    expect(toml).toContain('Cross-Origin-Opener-Policy = "same-origin"');
    expect(toml).toContain('Cross-Origin-Resource-Policy = "same-origin"');
    expect(toml).toContain('X-Frame-Options = "DENY"');
    expect(toml).toContain('Strict-Transport-Security = "max-age=31536000; includeSubDomains; preload"');
  });
});
