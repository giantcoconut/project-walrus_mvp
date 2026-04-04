const TRACKING_PARAM_KEYS = new Set([
  'gclid',
  'fbclid',
  'igshid',
  'mc_cid',
  'mc_eid',
  'ref',
  'source',
  'campaign',
  'cmpid',
  'mkt_tok',
  'spm',
  'si',
  'feature',
]);

const SINGLE_QUOTE_VARIANTS = /[\u2018\u2019\u201A\u201B\u2032\u2035\u0060\u00B4\u02BC]/g;
const DOUBLE_QUOTE_VARIANTS = /[\u201C\u201D\u201E\u201F\u2033\u2036\uFF02]/g;
const URL_PREFIX_RE = /^[a-z][a-z0-9+.-]*:\/\//i;
const BARE_HOST_RE = /^(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)+(?::\d+)?(?:[/?#].*)?$/i;

function isTrackingParam(key: string): boolean {
  const normalizedKey = key.toLowerCase();
  return normalizedKey.startsWith('utm_') || TRACKING_PARAM_KEYS.has(normalizedKey);
}

function stripWwwPrefix(hostname: string): string {
  return hostname.replace(/^www\./i, '');
}

function isUrlLike(input: string): boolean {
  return URL_PREFIX_RE.test(input) || BARE_HOST_RE.test(input);
}

function parseUrlLike(input: string): URL {
  const trimmed = input.trim();

  if (!trimmed) {
    throw new Error('URL input cannot be empty.');
  }

  if (!isUrlLike(trimmed)) {
    throw new Error(`Invalid URL input: "${input}"`);
  }

  const candidate = URL_PREFIX_RE.test(trimmed) ? trimmed : `https://${trimmed}`;
  const parsed = new URL(candidate);

  if (!parsed.hostname) {
    throw new Error(`Invalid URL input: "${input}"`);
  }

  return parsed;
}

function normalizePathname(pathname: string): string {
  if (!pathname) {
    return '/';
  }

  const collapsed = pathname.replace(/\/+/g, '/');

  if (collapsed === '/') {
    return '/';
  }

  return collapsed.replace(/\/+$/g, '');
}

export function canonicalizeUrl(input: string): string {
  const parsed = parseUrlLike(input);
  const hostname = stripWwwPrefix(parsed.hostname.toLowerCase());
  const normalizedPath = normalizePathname(parsed.pathname);

  const params = Array.from(parsed.searchParams.entries())
    .filter(([key]) => !isTrackingParam(key))
    .sort(([leftKey, leftValue], [rightKey, rightValue]) => {
      if (leftKey === rightKey) {
        return leftValue.localeCompare(rightValue);
      }

      return leftKey.localeCompare(rightKey);
    });

  const serializedParams = new URLSearchParams();

  for (const [key, value] of params) {
    serializedParams.append(key, value);
  }

  const query = serializedParams.toString();
  const port = parsed.port ? `:${parsed.port}` : '';

  return `${hostname}${port}${normalizedPath}${query ? `?${query}` : ''}`;
}

export function canonicalizeLabel(input: string): string {
  const normalized = input
    .normalize('NFKC')
    .replace(SINGLE_QUOTE_VARIANTS, "'")
    .replace(DOUBLE_QUOTE_VARIANTS, '"')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');

  if (!normalized) {
    throw new Error('Label input cannot be empty.');
  }

  return normalized;
}

export function canonicalizeSource(input: string): string {
  const trimmed = input.trim();

  if (!trimmed) {
    throw new Error('Source input cannot be empty.');
  }

  if (isUrlLike(trimmed)) {
    const parsed = parseUrlLike(trimmed);
    return stripWwwPrefix(parsed.hostname.toLowerCase());
  }

  return canonicalizeLabel(trimmed);
}
