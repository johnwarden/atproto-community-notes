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
 * Access-token signatures are checked against the issuer's JWKS — this service
 * is not the authorization server, so it cannot use OAuthVerifier's local keyset.
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

    const tokenClaims = await verifyAccessTokenJwt(accessToken, fetchFn)

    if (!tokenClaims.sub || !tokenClaims.sub.startsWith('did:')) {
      return {
        success: false,
        scheme: 'dpop',
        error: 'Invalid or missing user DID in access token',
      }
    }

    const tokenJkt = tokenClaims.cnf?.jkt
    if (!tokenJkt || typeof tokenJkt !== 'string') {
      return {
        success: false,
        scheme: 'dpop',
        error: 'Access token is not DPoP-bound (missing cnf.jkt)',
      }
    }

    if (tokenJkt !== jkt) {
      return {
        success: false,
        scheme: 'dpop',
        error: 'DPoP proof key does not match access token cnf.jkt',
      }
    }

    log.debug(
      { did: tokenClaims.sub, htm: method, htu: expectedHtu },
      'Verified DPoP-bound OAuth access token',
    )

    return {
      success: true,
      did: tokenClaims.sub,
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

async function verifyAccessTokenJwt(
  token: string,
  fetchFn: AuthFetch,
): Promise<AccessTokenClaims> {
  const header = decodeProtectedHeader(token)
  const unsafeClaims = decodeJwt(token) as AccessTokenClaims

  if (!unsafeClaims.iss || typeof unsafeClaims.iss !== 'string') {
    throw new Error('Access token missing iss')
  }

  const jwk = await resolveIssuerJwk(unsafeClaims.iss, header.kid, fetchFn)
  const { payload } = await jwtVerify(token, await importJWK(jwk, header.alg), {
    clockTolerance: DPOP_CLOCK_TOLERANCE_SEC,
  })

  return payload as AccessTokenClaims
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
