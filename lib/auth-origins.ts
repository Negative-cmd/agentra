/** Trust configured origins and platform-provided Vercel domains only.
 * Never derive trust from Host, X-Forwarded-Host, or an arbitrary Origin header. */
export function trustedAuthOrigins(): string[] {
  const origins: string[] = [];
  const onVercel = process.env.VERCEL === '1';
  const platformDomain = (value?: string) => {
    if (value && /^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/i.test(value)) origins.push(`https://${value.toLowerCase()}`);
  };
  if (onVercel && process.env.VERCEL_ENV === 'production') platformDomain(process.env.VERCEL_PROJECT_PRODUCTION_URL);
  if (process.env.APP_URL) {
    try {
      const url = new URL(process.env.APP_URL);
      if (!url.username && !url.password && (url.protocol === 'https:' || (!onVercel && url.protocol === 'http:'))) origins.push(url.origin);
    } catch { /* A valid trusted platform domain can recover a stale APP_URL. */ }
  }
  if (onVercel) platformDomain(process.env.VERCEL_URL);
  if (!origins.length && !onVercel) origins.push('http://localhost:3000');
  return [...new Set(origins)];
}

export function canonicalAuthOrigin(): string {
  const origin = trustedAuthOrigins()[0];
  if (!origin) throw new Error('Authentication needs APP_URL or a trusted Vercel domain');
  return origin;
}

export function isTrustedAuthOrigin(origin: string | null): origin is string {
  return origin !== null && trustedAuthOrigins().includes(origin);
}

export function challengeAuthOrigin(request: Request): string {
  const origin = request.headers.get('origin');
  if (isTrustedAuthOrigin(origin)) return origin;
  const requestOrigin = new URL(request.url).origin;
  return isTrustedAuthOrigin(requestOrigin) ? requestOrigin : canonicalAuthOrigin();
}
