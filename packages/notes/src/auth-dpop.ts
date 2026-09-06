import { createHash } from 'node:crypto'
import {
  EmbeddedJWK,
  calculateJwkThumbprint,
  decodeJwt,
  decodeProtectedHeader,
  errors,
  importJWK,
  jwtVerify,
} from 'jose'
import { AuthFetch, AuthRequest, AuthResult, headerValue } from './auth-types'
import { appLogger as log } from './logger'

const { JOSEError } = errors

/** DPoP proofs must be recent (RFC 9449). 60s + 5s skew matches typical RS practice. */
const DPOP_MAX_AGE_SEC = 60
const DPOP_CLOCK_TOLERANCE_SEC = 5

export interface DpopVerifyOptions {
  fetchFn?: AuthFetch
  publicUrl?: string
}

/**
 * Verify a DPoP-bound AT Protocol OAuth access token on this resource server.
 *
 * Crypto and claim checks follow the same rules as @atproto/oauth-provider's
 * DpopManager (jose EmbeddedJWK, typ=dpop+jwt, htm/htu/ath, jkt binding).
 * Access-token signatures are checked against the issuer's JWKS when keys are
 * published. Empty JWKS (Bluesky entryway today) is not locally RS-verifiable
 * and is not treated as "accept any DPoP". This RS cannot replay the
 * notes-bound DPoP proof to a PDS (htu would fail). Clients should send a
 * service-auth JWT instead (`auth-service-jwt.ts`).
 */
export async function verifyDpopBoundAccessToken(
  req: AuthRequest,
  accessToken: string,
  options: DpopVerifyOptions = {},
): Promise<AuthResult> {
  const fetchFn = options.fetchFn || fetch

  try {
    const dpopHeader = headerValue(req.headers, 'dpop')
    if (!dpopHeader) {
      return {
        success: false,
        scheme: 'dpop',
        error: 'DPoP proof header is required',
      }
    }

    const method = (req.method || 'GET').toUpperCase()
    const requestUrl = buildRequestUrl(req, options.publicUrl)
    const expectedHtu = normalizeHtuUrl(requestUrl)

    const { protectedHeader, payload } = await jwtVerify(
      dpopHeader,
      EmbeddedJWK,
      {
        typ: 'dpop+jwt',
        maxTokenAge: DPOP_MAX_AGE_SEC,
        clockTolerance: DPOP_CLOCK_TOLERANCE_SEC,
      },
    )

    const { ath, htm, htu, jti } = payload

    // jti is required (RFC 9449). v1 checks presence only — no replay store.
    if (!jti || typeof jti !== 'string') {
      return dpopFail('DPoP "jti" missing')
    }

    if (!htm || typeof htm !== 'string' || htm !== method) {
      return dpopFail('DPoP "htm" mismatch')
    }

    if (!htu || typeof htu !== 'string') {
      return dpopFail('Invalid DPoP "htu" type')
    }

    if (normalizeHtuClaim(htu) !== expectedHtu) {
      return dpopFail('DPoP "htu" mismatch')
    }

    const accessTokenHash = createHash('sha256').update(accessToken).digest()
    if (ath !== accessTokenHash.toString('base64url')) {
      return dpopFail('DPoP "ath" mismatch')
    }

    const jwk = protectedHeader.jwk
    if (!jwk) {
      return dpopFail('DPoP proof missing embedded JWK')
    }

    const jkt = await calculateJwkThumbprint(jwk, 'sha256')

    const verified = await verifyAccessTokenAgainstIssuerJwks(
      accessToken,
      jkt,
      fetchFn,
    )

    if (!verified.ok) {
      return dpopFail(verified.error)
    }

    log.debug(
      {
        did: verified.did,
        htm: method,
        htu: expectedHtu,
        via: verified.via,
      },
      'Verified DPoP-bound OAuth access token',
    )

    return {
      success: true,
      did: verified.did,
      scheme: 'dpop',
    }
  } catch (error) {
    const errorMessage =
      error instanceof JOSEError || error instanceof Error
        ? error.message
        : 'Unknown error'
    log.warn({ error: errorMessage }, 'DPoP authentication failed')
    return {
      success: false,
      scheme: 'dpop',
      error: `DPoP verification failed: ${errorMessage}`,
    }
  }
}

interface AccessTokenClaims {
  sub?: string
  iss?: string
  exp?: number
  scope?: string
  cnf?: { jkt?: string }
}

type TokenVerifyResult =
  | { ok: true; did: string; via: 'jwks' }
  | { ok: false; error: string }

type LocalJwtVerify =
  | { kind: 'verified'; claims: AccessTokenClaims }
  | { kind: 'unverifiable'; reason: string }
  | { kind: 'invalid'; error: Error }

const EMPTY_JWKS_SERVICE_AUTH_HINT =
  'Access token is not locally RS-verifiable (issuer JWKS empty or unavailable). This resource server will not replay DPoP to a PDS (htu mismatch). Use a service-auth JWT from com.atproto.server.getServiceAuth (aud=notes service DID, lxm-scoped).'

/**
 * Local RS verify against issuer JWKS only. Empty JWKS / non-JWT is a hard
 * reject — never getSession with the notes-bound DPoP proof, never accept-any.
 */
async function verifyAccessTokenAgainstIssuerJwks(
  accessToken: string,
  jkt: string,
  fetchFn: AuthFetch,
): Promise<TokenVerifyResult> {
  const local = await tryVerifyAccessTokenJwt(accessToken, fetchFn)

  if (local.kind === 'verified') {
    if (!local.claims.sub || !local.claims.sub.startsWith('did:')) {
      return { ok: false, error: 'Invalid or missing user DID in access token' }
    }

    const tokenJkt = local.claims.cnf?.jkt
    if (!tokenJkt || typeof tokenJkt !== 'string') {
      return {
        ok: false,
        error: 'Access token is not DPoP-bound (missing cnf.jkt)',
      }
    }

    if (tokenJkt !== jkt) {
      return {
        ok: false,
        error: 'DPoP proof key does not match access token cnf.jkt',
      }
    }

    return { ok: true, did: local.claims.sub, via: 'jwks' }
  }

  if (local.kind === 'invalid') {
    return {
      ok: false,
      error: `Access token JWT verification failed: ${local.error.message}`,
    }
  }

  log.debug(
    { reason: local.reason },
    'Access token not locally RS-verifiable; refusing DPoP (use service-auth)',
  )
  return { ok: false, error: EMPTY_JWKS_SERVICE_AUTH_HINT }
}

async function tryVerifyAccessTokenJwt(
  token: string,
  fetchFn: AuthFetch,
): Promise<LocalJwtVerify> {
  let header: ReturnType<typeof decodeProtectedHeader>
  let unsafeClaims: AccessTokenClaims
  try {
    header = decodeProtectedHeader(token)
    unsafeClaims = decodeJwt(token) as AccessTokenClaims
  } catch (error) {
    return {
      kind: 'unverifiable',
      reason: error instanceof Error ? error.message : 'not_jwt',
    }
  }

  if (!unsafeClaims.iss || typeof unsafeClaims.iss !== 'string') {
    return { kind: 'unverifiable', reason: 'missing_iss' }
  }

  let jwk: Record<string, unknown>
  try {
    jwk = await resolveIssuerJwk(unsafeClaims.iss, header.kid, fetchFn)
  } catch (error) {
    return {
      kind: 'unverifiable',
      reason: error instanceof Error ? error.message : 'jwks_unavailable',
    }
  }

  try {
    const { payload } = await jwtVerify(
      token,
      await importJWK(jwk, header.alg),
      { clockTolerance: DPOP_CLOCK_TOLERANCE_SEC },
    )
    return { kind: 'verified', claims: payload as AccessTokenClaims }
  } catch (error) {
    return {
      kind: 'invalid',
      error: error instanceof Error ? error : new Error('jwt verify failed'),
    }
  }
}

async function resolveIssuerJwk(
  iss: string,
  kid: string | undefined,
  fetchFn: AuthFetch,
): Promise<Record<string, unknown>> {
  const issuerUrl = parseIssuerUrl(iss)

  const jwksUri = await discoverJwksUri(issuerUrl, fetchFn)
  const jwksRes = await fetchFn(jwksUri)
  if (!jwksRes.ok) {
    throw new Error(`Failed to fetch issuer JWKS (${jwksRes.status})`)
  }

  const jwks = (await jwksRes.json()) as {
    keys?: Array<Record<string, unknown> & { kid?: string }>
  }
  if (!jwks.keys?.length) {
    throw new Error('Issuer JWKS has no keys')
  }

  const match = kid ? jwks.keys.find((key) => key.kid === kid) : undefined
  return match || jwks.keys[0]
}

async function discoverJwksUri(
  issuerUrl: URL,
  fetchFn: AuthFetch,
): Promise<string> {
  const metadataUrls = [
    new URL('/.well-known/oauth-authorization-server', issuerUrl).href,
    new URL('/.well-known/openid-configuration', issuerUrl).href,
  ]

  for (const metadataUrl of metadataUrls) {
    try {
      const res = await fetchFn(metadataUrl)
      if (!res.ok) continue
      const body = (await res.json()) as { jwks_uri?: string }
      if (body.jwks_uri && typeof body.jwks_uri === 'string') {
        return body.jwks_uri
      }
    } catch {
      // try next discovery document, then ATProto default
    }
  }

  return new URL('/oauth/jwks', issuerUrl).href
}

function parseIssuerUrl(iss: string): URL {
  let url: URL
  try {
    url = new URL(iss)
  } catch {
    throw new Error('Access token iss is not a valid URL')
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error('Access token iss must be http or https')
  }
  return url
}

export function buildRequestUrl(req: AuthRequest, publicUrl?: string): URL {
  const pathAndQuery = req.originalUrl || req.url || '/'
  if (publicUrl) {
    return new URL(pathAndQuery, publicUrl)
  }
  const host =
    req.get?.('host') || headerValue(req.headers, 'host') || 'localhost'
  const proto = req.protocol || 'http'
  return new URL(pathAndQuery, `${proto}://${host}`)
}

function normalizeHtuUrl(url: URL): string {
  return url.origin + url.pathname
}

function normalizeHtuClaim(htu: string): string {
  let url: URL
  try {
    url = new URL(htu)
  } catch {
    throw new Error('DPoP "htu" is not a valid URL')
  }
  if (url.username || url.password) {
    throw new Error('DPoP "htu" must not contain credentials')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('DPoP "htu" must be http or https')
  }
  return normalizeHtuUrl(url)
}

function dpopFail(error: string): AuthResult {
  return { success: false, scheme: 'dpop', error }
}
