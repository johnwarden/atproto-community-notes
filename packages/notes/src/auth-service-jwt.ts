import { verifyJwt } from '@atproto/xrpc-server'
import { AuthRequest, AuthResult } from './auth-types'
import { appLogger as log } from './logger'

export type ServiceSigningKeyFn = (
  iss: string,
  forceRefresh: boolean,
) => Promise<string>

/**
 * AT Protocol service-auth JWT (com.atproto.server.getServiceAuth).
 *
 * The client mints this at their PDS with a DPoP proof bound to the *PDS*
 * getServiceAuth URL, then sends `Authorization: Bearer <jwt>` here.
 * This resource server never sees or replays the notes-request DPoP proof.
 *
 * Checks: aud = notes service DID or `did#serviceId`, lxm = this XRPC method,
 * exp, signature against the issuer DID's atproto signing key. Garbage is
 * rejected. `verifyJwt` audience is checked here so both aud forms work.
 */
export async function verifyServiceAuthJwt(
  token: string,
  opts: {
    serviceDid: string
    lxm: string
    getSigningKey: ServiceSigningKeyFn
  },
): Promise<AuthResult> {
  try {
    const payload = await verifyJwt(token, null, opts.lxm, opts.getSigningKey)

    if (!audienceMatchesService(payload.aud, opts.serviceDid)) {
      return {
        success: false,
        scheme: 'service',
        error: 'jwt audience does not match service did',
      }
    }

    const did = didFromServiceIss(payload.iss)
    if (!did) {
      return {
        success: false,
        scheme: 'service',
        error: 'Service-auth JWT iss is not a DID',
      }
    }

    log.debug(
      { did, aud: payload.aud, lxm: payload.lxm },
      'Verified AT Protocol service-auth JWT',
    )

    return {
      success: true,
      did,
      scheme: 'service',
    }
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : 'Unknown error'
    log.warn({ error: errorMessage }, 'Service-auth JWT verification failed')
    return {
      success: false,
      scheme: 'service',
      error: `Service-auth verification failed: ${errorMessage}`,
    }
  }
}

/**
 * True when Bearer claims look like AT Protocol service-auth: `iss` is a DID
 * and `lxm` is present. A password accessJwt that happens to use a DID `iss`
 * (no `lxm`) must stay on the getSession path.
 */
export function looksLikeServiceAuthJwt(token: string): boolean {
  try {
    const parts = token.split('.')
    if (parts.length !== 3) return false
    const padded = parts[1] + '='.repeat((4 - (parts[1].length % 4)) % 4)
    const json = Buffer.from(
      padded.replace(/-/g, '+').replace(/_/g, '/'),
      'base64',
    ).toString('utf8')
    const payload = JSON.parse(json) as { iss?: unknown; lxm?: unknown }
    return (
      typeof payload.iss === 'string' &&
      payload.iss.startsWith('did:') &&
      typeof payload.lxm === 'string' &&
      payload.lxm.length > 0
    )
  } catch {
    return false
  }
}

export function lexiconMethodFromRequest(req: AuthRequest): string | null {
  const raw = req.originalUrl || req.url || ''
  const path = raw.split('?')[0]
  const match = /^\/xrpc\/([a-zA-Z][a-zA-Z0-9.-]*)/.exec(path)
  return match?.[1] ?? null
}

export function didFromServiceIss(iss: string): string | undefined {
  const did = iss.includes('#') ? iss.slice(0, iss.indexOf('#')) : iss
  return did.startsWith('did:') ? did : undefined
}

/** Bare notes DID or AT Protocol `did#serviceId` (e.g. did:plc:notes#atproto_pds). */
export function audienceMatchesService(
  aud: string,
  serviceDid: string,
): boolean {
  if (aud === serviceDid) return true
  if (!aud.startsWith(`${serviceDid}#`)) return false
  const fragment = aud.slice(serviceDid.length + 1)
  return fragment.length > 0 && !fragment.includes('#')
}
