export interface AuthResult {
  success: boolean
  did?: string
  error?: string
  /**
   * True when no Authorization header was sent. Optional-auth callers
   * (getProposals, feeds) treat this as anonymous; required-auth callers
   * (propose, vote) treat it as 401.
   */
  missing?: boolean
  scheme?: 'bearer' | 'dpop' | 'service'
}

/**
 * Minimal request shape accepted by verifyAuthHeader. Compatible with Express
 * and XRPC handler `req` objects.
 */
export interface AuthRequest {
  headers: Record<string, string | string[] | undefined>
  method?: string
  url?: string
  originalUrl?: string
  protocol?: string
  get?(name: string): string | undefined
}

export function headerValue(
  headers: Record<string, string | string[] | undefined>,
  name: string,
): string | undefined {
  const raw = headers[name] ?? headers[name.toLowerCase()]
  if (Array.isArray(raw)) {
    return raw[0]
  }
  return raw
}

export type ParsedAuthorization =
  | { missing: true }
  | { error: string }
  | { scheme: 'bearer' | 'dpop'; token: string }

/**
 * Parse Authorization as either a password-session Bearer JWT or a DPoP-bound
 * OAuth access token. Scheme names are case-insensitive (RFC 6750 / RFC 9449).
 */
export function parseAuthorizationHeader(
  header?: string | string[],
): ParsedAuthorization {
  const raw = Array.isArray(header) ? header[0] : header
  if (raw == null || raw.trim() === '') {
    return { missing: true }
  }

  const trimmed = raw.trim()
  const match = /^([A-Za-z]+)\s+(.*)$/.exec(trimmed)
  if (!match) {
    const schemeOnly = trimmed.toLowerCase()
    if (schemeOnly === 'bearer') {
      return { error: 'Empty Bearer token' }
    }
    if (schemeOnly === 'dpop') {
      return { error: 'Empty DPoP access token' }
    }
    return { error: 'Missing or invalid Authorization header' }
  }

  const scheme = match[1].toLowerCase()
  const token = match[2].trim()

  if (scheme === 'bearer') {
    if (!token) {
      return { error: 'Empty Bearer token' }
    }
    return { scheme: 'bearer', token }
  }

  if (scheme === 'dpop') {
    if (!token) {
      return { error: 'Empty DPoP access token' }
    }
    return { scheme: 'dpop', token }
  }

  return { error: `Unsupported Authorization scheme: ${match[1]}` }
}

export type DpopVerifier = (
  req: AuthRequest,
  accessToken: string,
) => Promise<AuthResult>

export type AuthFetch = (
  input: string | URL,
  init?: RequestInit,
) => Promise<Response>

export interface AuthServiceOptions {
  fetchFn?: AuthFetch
  verifyDpop?: DpopVerifier
  publicUrl?: string
  /**
   * Notes service DID (`REPO_DID` / getConfig.feedGeneratorDid). Required
   * to verify AT Protocol service-auth JWTs (`aud` must match).
   */
  serviceDid?: string
  /**
   * Override DID → atproto signing key resolution for service-auth JWTs.
   * Defaults to IdResolver.resolveAtprotoKey.
   */
  getSigningKey?: (iss: string, forceRefresh: boolean) => Promise<string>
  /**
   * Override PDS resolution from a user DID. Defaults to AT Protocol
   * identity (DID document AtprotoPersonalDataServer). Used for password
   * session getSession only — never for DPoP replay.
   */
  resolvePdsUrl?: (did: string) => Promise<string | null>
}
