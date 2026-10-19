import { describe, expect, it } from 'bun:test';
import { escapeHtml } from '../src/ui/uiController';

describe('escapeHtml (XSS-safe innerHTML rendering)', () => {
  it('escapes all HTML metacharacters', () => {
    expect(escapeHtml(`<img src=x onerror="alert('1')">&`)).toBe(
      '&lt;img src=x onerror=&quot;alert(&#39;1&#39;)&quot;&gt;&amp;'
    );
  });

  it('leaves safe SAN move text untouched', () => {
    expect(escapeHtml('Nf3')).toBe('Nf3');
    expect(escapeHtml('exd8=Q+')).toBe('exd8=Q+');
  });
});
