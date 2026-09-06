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
  /**
   * Resolve a user's PDS from their DID (DID document /
   * AtprotoPersonalDataServer). Used only as a routing hint when falling
   * back to getSession; the authenticated DID still comes from getSession.
   */
  resolvePdsUrl?: (did: string) => Promise<string | null>
  /**
   * Service-configured PDS URL (dev-env / PDS_URL). Last-resort routing
   * hint when identity resolution and token `iss` are unavailable.
   */
  defaultPdsUrl?: string
}

/**
 * Verify a DPoP-bound AT Protocol OAuth access token on this resource server.
 *
 * Crypto and claim checks follow the same rules as @atproto/oauth-provider's
 * DpopManager (jose EmbeddedJWK, typ=dpop+jwt, htm/htu/ath, jkt binding).
 * Access-token signatures are checked against the issuer's JWKS when keys are
 * published. If JWKS is empty (or the token is not locally RS-verifiable),
 * the token is validated at the user's PDS via getSession with the same DPoP
 * headers. This service is not the authorization server, so it cannot use
 * OAuthVerifier's local keyset.
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

    const verified = await verifyAccessTokenOrPdsSession({
      accessToken,
      dpopProof: dpopHeader,
      jkt,
      fetchFn,
      resolvePdsUrl: options.resolvePdsUrl,
      defaultPdsUrl: options.defaultPdsUrl,
    })

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
  | { ok: true; did: string; via: 'jwks' | 'getSession' }
  | { ok: false; error: string }

type LocalJwtVerify =
  | { kind: 'verified'; claims: AccessTokenClaims }
  | { kind: 'unverifiable'; reason: string }
  | { kind: 'invalid'; error: Error }

/**
 * Verify the access token as a resource server (issuer JWKS) when possible.
 * If the issuer JWKS is empty or the token is not locally RS-verifiable,
 * validate it at the user's PDS via com.atproto.server.getSession, forwarding
 * `Authorization: DPoP <token>` and the same DPoP proof.
 *
 * The authenticated DID is taken from verified JWKS claims or from getSession
 * — never from an unverified JWT alone. Empty JWKS is not treated as "accept
 * any DPoP"; getSession must succeed.
 *
 * When falling back to getSession, unverified `sub`/`iss` are routing hints
 * only. If those claims include `cnf.jkt`, it must match the DPoP thumbprint.
 * Otherwise DPoP binding is left to the PDS (the proof was already checked
 * locally: EmbeddedJWK, typ, htm/htu/ath/jti).
 */
async function verifyAccessTokenOrPdsSession(opts: {
  accessToken: string
  dpopProof: string
  jkt: string
  fetchFn: AuthFetch
  resolvePdsUrl?: (did: string) => Promise<string | null>
  defaultPdsUrl?: string
}): Promise<TokenVerifyResult> {
  const local = await tryVerifyAccessTokenJwt(opts.accessToken, opts.fetchFn)

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

    if (tokenJkt !== opts.jkt) {
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
    'Access token not locally RS-verifiable; validating via PDS getSession',
  )

  return validateAccessTokenViaGetSession(opts)
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

/**
 * PDS getSession fallback. DID is taken from the PDS response. Token claims
 * are not trusted for identity; they are only used to find which PDS to call
 * and (when present) to check cnf.jkt against the already-verified DPoP key.
 */
async function validateAccessTokenViaGetSession(opts: {
  accessToken: string
  dpopProof: string
  jkt: string
  fetchFn: AuthFetch
  resolvePdsUrl?: (did: string) => Promise<string | null>
  defaultPdsUrl?: string
}): Promise<TokenVerifyResult> {
  const cnfError = optionalCnfJktMismatch(opts.accessToken, opts.jkt)
  if (cnfError) {
    return { ok: false, error: cnfError }
  }

  const candidates = await resolvePdsCandidates(
    opts.accessToken,
    opts.resolvePdsUrl,
    opts.defaultPdsUrl,
  )

  if (candidates.length === 0) {
    return {
      ok: false,
      error:
        'Cannot resolve PDS URL for DPoP access token (empty issuer JWKS; no DID/identity, iss, or default PDS)',
    }
  }

  let lastError = 'PDS getSession rejected DPoP access token'
  for (const pdsUrl of candidates) {
    const session = await callPdsGetSessionDpop(
      pdsUrl,
      opts.accessToken,
      opts.dpopProof,
      opts.fetchFn,
    )
    if (session.ok) {
      log.debug(
        { did: session.did, pdsUrl },
        'Validated DPoP access token via PDS getSession',
      )
      return { ok: true, did: session.did, via: 'getSession' }
    }
    lastError = session.error
  }

  return { ok: false, error: lastError }
}

/**
 * If the token is a JWT and advertises cnf.jkt, require it to match the DPoP
 * thumbprint. Missing/unreadable claims are OK: the PDS enforces DPoP binding
 * on getSession, and this resource server already verified the proof.
 */
function optionalCnfJktMismatch(token: string, jkt: string): string | null {
  try {
    const claims = decodeJwt(token) as AccessTokenClaims
    const tokenJkt = claims.cnf?.jkt
    if (tokenJkt && tokenJkt !== jkt) {
      return 'DPoP proof key does not match access token cnf.jkt'
    }
  } catch {
    // Opaque / non-JWT: rely on PDS DPoP binding.
  }
  return null
}

async function resolvePdsCandidates(
  accessToken: string,
  resolvePdsUrl?: (did: string) => Promise<string | null>,
  defaultPdsUrl?: string,
): Promise<string[]> {
  const candidates: string[] = []
  const seen = new Set<string>()

  const add = (url: string | null | undefined) => {
    if (!url) return
    try {
      const parsed = new URL(url)
      if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return
      const normalized = parsed.href.replace(/\/+$/, '')
      if (seen.has(normalized)) return
      seen.add(normalized)
      candidates.push(normalized)
    } catch {
      // skip invalid URLs
    }
  }

  let claims: AccessTokenClaims | undefined
  try {
    claims = decodeJwt(accessToken) as AccessTokenClaims
  } catch {
    // opaque token — identity resolution needs an explicit DID resolver default
  }

  const routingDid =
    claims?.sub && typeof claims.sub === 'string' && claims.sub.startsWith('did:')
      ? claims.sub
      : undefined

  if (routingDid && resolvePdsUrl) {
    try {
      add(await resolvePdsUrl(routingDid))
    } catch (error) {
      log.warn(
        {
          did: routingDid,
          error: error instanceof Error ? error.message : 'Unknown error',
        },
        'DID/identity PDS resolution failed; trying token iss / default PDS',
      )
    }
  }

  if (claims?.iss && typeof claims.iss === 'string') {
    add(claims.iss)
  }

  add(defaultPdsUrl)
  return candidates
}

async function callPdsGetSessionDpop(
  pdsUrl: string,
  accessToken: string,
  dpopProof: string,
  fetchFn: AuthFetch,
): Promise<{ ok: true; did: string } | { ok: false; error: string }> {
  try {
    const response = await fetchFn(
      `${pdsUrl}/xrpc/com.atproto.server.getSession`,
      {
        method: 'GET',
        headers: {
          Authorization: `DPoP ${accessToken}`,
          DPoP: dpopProof,
          'Content-Type': 'application/json',
        },
      },
    )

    if (!response.ok) {
      const errorText = await response.text()
      return {
        ok: false,
        error: `PDS getSession returned ${response.status}: ${errorText}`,
      }
    }

    const data = (await response.json()) as { did?: string }
    if (!data.did || !data.did.startsWith('did:')) {
      return { ok: false, error: 'No DID in PDS getSession response' }
    }

    return { ok: true, did: data.did }
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : 'Unknown error'
    return { ok: false, error: `Failed to contact PDS: ${errorMessage}` }
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
