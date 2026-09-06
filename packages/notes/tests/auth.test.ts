import assert from 'node:assert'
import { createHash } from 'node:crypto'
import { describe, test } from 'node:test'
import {
  SignJWT,
  calculateJwkThumbprint,
  exportJWK,
  generateKeyPair,
} from 'jose'
import { AuthService, parseAuthorizationHeader } from '../src/auth'
import { buildRequestUrl, verifyDpopBoundAccessToken } from '../src/auth-dpop'
import type { AuthRequest, AuthResult } from '../src/auth-types'

function fakeJwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(
    JSON.stringify({ alg: 'none', typ: 'JWT' }),
  ).toString('base64url')
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url')
  return `${header}.${body}.sig`
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

/** Mirrors getProposals: missing header is anonymous; anything else must succeed. */
function getProposalsAuthMode(
  result: AuthResult,
): 'anon' | 'authed' | 'reject' {
  if (result.missing) return 'anon'
  if (result.success) return 'authed'
  return 'reject'
}

describe('parseAuthorizationHeader', () => {
  test('missing header', () => {
    assert.deepStrictEqual(parseAuthorizationHeader(undefined), {
      missing: true,
    })
    assert.deepStrictEqual(parseAuthorizationHeader(''), { missing: true })
    assert.deepStrictEqual(parseAuthorizationHeader('   '), { missing: true })
  })

  test('empty Bearer fails (not missing)', () => {
    assert.deepStrictEqual(parseAuthorizationHeader('Bearer'), {
      error: 'Empty Bearer token',
    })
    assert.deepStrictEqual(parseAuthorizationHeader('Bearer '), {
      error: 'Empty Bearer token',
    })
    assert.deepStrictEqual(parseAuthorizationHeader('Bearer   '), {
      error: 'Empty Bearer token',
    })
  })

  test('parses Bearer and DPoP tokens', () => {
    assert.deepStrictEqual(parseAuthorizationHeader('Bearer abc.def.ghi'), {
      scheme: 'bearer',
      token: 'abc.def.ghi',
    })
    assert.deepStrictEqual(parseAuthorizationHeader('DPoP oauth-access'), {
      scheme: 'dpop',
      token: 'oauth-access',
    })
    assert.deepStrictEqual(parseAuthorizationHeader('dpop oauth-access'), {
      scheme: 'dpop',
      token: 'oauth-access',
    })
  })
})

describe('AuthService.verifyAuthHeader', () => {
  test('password Bearer success (mock PDS)', async () => {
    const did = 'did:plc:alice-test'
    const token = fakeJwt({
      sub: did,
      iss: 'http://pds.test',
      scope: 'com.atproto.access',
    })

    const fetchFn = async (input: string | URL): Promise<Response> => {
      const url = String(input)
      assert.match(url, /com\.atproto\.server\.getSession/)
      return jsonResponse(200, { did })
    }

    const auth = new AuthService('http://pds.test', { fetchFn })
    const result = await auth.verifyAuthHeader({
      headers: { authorization: `Bearer ${token}` },
      method: 'GET',
      url: '/xrpc/org.opencommunitynotes.getProposals',
    })

    assert.strictEqual(result.success, true)
    assert.strictEqual(result.did, did)
    assert.strictEqual(result.scheme, 'bearer')
    assert.strictEqual(result.missing, undefined)
  })

  test('empty Bearer → fail (not anonymous)', async () => {
    const auth = new AuthService('http://pds.test', {
      fetchFn: async () => {
        throw new Error('PDS should not be contacted for empty Bearer')
      },
    })

    for (const authorization of ['Bearer', 'Bearer ', 'Bearer   ']) {
      const result = await auth.verifyAuthHeader({
        headers: { authorization },
        method: 'GET',
        url: '/xrpc/org.opencommunitynotes.getProposals',
      })
      assert.strictEqual(result.success, false)
      assert.notStrictEqual(result.missing, true)
      assert.strictEqual(getProposalsAuthMode(result), 'reject')
      assert.match(result.error || '', /Empty Bearer token/)
    }
  })

  test('missing header handled by callers (getProposals soft-anon)', async () => {
    const auth = new AuthService('http://pds.test', {
      fetchFn: async () => {
        throw new Error('PDS should not be contacted when auth is missing')
      },
    })

    const result = await auth.verifyAuthHeader({
      headers: {},
      method: 'GET',
      url: '/xrpc/org.opencommunitynotes.getProposals',
    })

    assert.strictEqual(result.success, false)
    assert.strictEqual(result.missing, true)
    assert.strictEqual(getProposalsAuthMode(result), 'anon')
  })

  test('DPoP/OAuth happy path (mocked verifier)', async () => {
    const did = 'did:plc:oauth-alice'
    const auth = new AuthService('http://pds.test', {
      fetchFn: async () => {
        throw new Error('PDS getSession must not run for DPoP')
      },
      verifyDpop: async (req: AuthRequest, accessToken: string) => {
        assert.strictEqual(accessToken, 'oauth-access-token')
        assert.strictEqual(headerOrThrow(req, 'dpop'), 'dpop-proof-jwt')
        return { success: true, did, scheme: 'dpop' }
      },
    })

    const result = await auth.verifyAuthHeader({
      headers: {
        authorization: 'DPoP oauth-access-token',
        dpop: 'dpop-proof-jwt',
      },
      method: 'POST',
      url: '/xrpc/org.opencommunitynotes.propose',
    })

    assert.strictEqual(result.success, true)
    assert.strictEqual(result.did, did)
    assert.strictEqual(result.scheme, 'dpop')
    assert.strictEqual(getProposalsAuthMode(result), 'authed')
  })

  test('invalid Bearer JWT fails without treating as missing', async () => {
    const auth = new AuthService('http://pds.test')
    const result = await auth.verifyAuthHeader({
      headers: { authorization: 'Bearer not-a-jwt' },
      method: 'GET',
      url: '/xrpc/org.opencommunitynotes.getProposals',
    })
    assert.strictEqual(result.success, false)
    assert.notStrictEqual(result.missing, true)
    assert.strictEqual(getProposalsAuthMode(result), 'reject')
  })
})

describe('verifyDpopBoundAccessToken (jose)', () => {
  test('happy path with generated ES256 keys and mocked issuer JWKS', async () => {
    const did = 'did:plc:dpop-alice'
    const issuer = 'https://pds.example'
    const { accessToken, dpopProof, asJwk } = await mintDpopAccess(
      did,
      issuer,
      'GET',
      'http://notes.test/xrpc/org.opencommunitynotes.getProposals',
    )

    const fetchFn = async (input: string | URL): Promise<Response> => {
      const url = String(input)
      if (url.includes('oauth-authorization-server')) {
        return jsonResponse(200, { jwks_uri: `${issuer}/oauth/jwks` })
      }
      if (url.endsWith('/oauth/jwks')) {
        return jsonResponse(200, { keys: [asJwk] })
      }
      throw new Error(`Unexpected fetch: ${url}`)
    }

    const result = await verifyDpopBoundAccessToken(
      {
        headers: {
          authorization: `DPoP ${accessToken}`,
          dpop: dpopProof,
          host: 'notes.test',
        },
        method: 'GET',
        url: '/xrpc/org.opencommunitynotes.getProposals',
        protocol: 'http',
      },
      accessToken,
      { fetchFn },
    )

    assert.strictEqual(result.success, true, result.error)
    assert.strictEqual(result.did, did)
    assert.strictEqual(result.scheme, 'dpop')
  })

  test('DPoP htu uses configured publicUrl, not pdsUrl or request host', async () => {
    const did = 'did:plc:public-url-alice'
    const issuer = 'https://issuer.example'
    const pdsUrl = 'http://pds.internal:2583'
    const publicUrl = 'https://api.bluenotes.social'
    const path = '/xrpc/org.opencommunitynotes.getProposals'
    const { accessToken, dpopProof, asJwk } = await mintDpopAccess(
      did,
      issuer,
      'GET',
      `${publicUrl}${path}`,
    )

    const fetchFn = async (input: string | URL): Promise<Response> => {
      const url = String(input)
      if (url.includes('oauth-authorization-server')) {
        return jsonResponse(200, { jwks_uri: `${issuer}/oauth/jwks` })
      }
      if (url.endsWith('/oauth/jwks')) {
        return jsonResponse(200, { keys: [asJwk] })
      }
      throw new Error(`Unexpected fetch: ${url}`)
    }

    const internalReq: AuthRequest = {
      headers: {
        authorization: `DPoP ${accessToken}`,
        dpop: dpopProof,
        host: '127.0.0.1:8080',
      },
      method: 'GET',
      url: path,
      protocol: 'http',
    }

    const auth = new AuthService(pdsUrl, { fetchFn, publicUrl })
    const result = await auth.verifyAuthHeader(internalReq)
    assert.strictEqual(result.success, true, result.error)
    assert.strictEqual(result.did, did)

    const built = buildRequestUrl(internalReq, publicUrl)
    assert.strictEqual(built.origin, publicUrl)
    assert.notStrictEqual(built.origin, new URL(pdsUrl).origin)
    assert.notStrictEqual(built.origin, 'http://127.0.0.1:8080')

    const pdsHtu = await mintDpopAccess(did, issuer, 'GET', `${pdsUrl}${path}`)
    const pdsAuth = new AuthService(pdsUrl, {
      fetchFn,
      publicUrl,
    })
    const pdsResult = await pdsAuth.verifyAuthHeader({
      headers: {
        authorization: `DPoP ${pdsHtu.accessToken}`,
        dpop: pdsHtu.dpopProof,
        host: '127.0.0.1:8080',
      },
      method: 'GET',
      url: path,
      protocol: 'http',
    })
    assert.strictEqual(pdsResult.success, false)
    assert.match(pdsResult.error || '', /htu/)
  })

  test('rejects DPoP scheme without proof header', async () => {
    const result = await verifyDpopBoundAccessToken(
      {
        headers: { authorization: 'DPoP some-token' },
        method: 'GET',
        url: '/xrpc/org.opencommunitynotes.getProposals',
      },
      'some-token',
    )
    assert.strictEqual(result.success, false)
    assert.match(result.error || '', /DPoP proof header is required/)
  })

  test('empty issuer JWKS validates via PDS getSession (DID from session)', async () => {
    const jwtDid = 'did:plc:jwt-alice'
    const sessionDid = 'did:plc:session-alice'
    const issuer = 'https://bsky.social'
    const resolvedPds = 'https://pds.custom.example'
    const path = '/xrpc/org.opencommunitynotes.getProposals'
    const { accessToken, dpopProof } = await mintDpopAccess(
      jwtDid,
      issuer,
      'GET',
      `http://notes.test${path}`,
    )

    let getSessionCalls = 0
    const fetched: string[] = []
    const fetchFn = async (
      input: string | URL,
      init?: RequestInit,
    ): Promise<Response> => {
      const url = String(input)
      fetched.push(url)
      if (url.includes('oauth-authorization-server')) {
        return jsonResponse(200, { jwks_uri: `${issuer}/oauth/jwks` })
      }
      if (url.endsWith('/oauth/jwks')) {
        return jsonResponse(200, { keys: [] })
      }
      if (url.includes('com.atproto.server.getSession')) {
        getSessionCalls += 1
        assert.strictEqual(
          url,
          `${resolvedPds}/xrpc/com.atproto.server.getSession`,
        )
        assert.strictEqual(init?.method, 'GET')
        const headers = headersFromInit(init)
        assert.strictEqual(headers.authorization, `DPoP ${accessToken}`)
        assert.strictEqual(headers.dpop, dpopProof)
        return jsonResponse(200, { did: sessionDid })
      }
      throw new Error(`Unexpected fetch: ${url}`)
    }

    const resolveCalls: string[] = []
    const result = await verifyDpopBoundAccessToken(
      {
        headers: {
          authorization: `DPoP ${accessToken}`,
          dpop: dpopProof,
          host: 'notes.test',
        },
        method: 'GET',
        url: path,
        protocol: 'http',
      },
      accessToken,
      {
        fetchFn,
        resolvePdsUrl: async (did) => {
          resolveCalls.push(did)
          return resolvedPds
        },
        defaultPdsUrl: 'https://should-not-use.example',
      },
    )

    assert.strictEqual(result.success, true, result.error)
    assert.strictEqual(result.did, sessionDid)
    assert.notStrictEqual(result.did, jwtDid)
    assert.strictEqual(result.scheme, 'dpop')
    assert.notStrictEqual(result.missing, true)
    assert.strictEqual(getProposalsAuthMode(result), 'authed')
    assert.strictEqual(getSessionCalls, 1)
    assert.deepStrictEqual(resolveCalls, [jwtDid])
    assert.ok(fetched.some((url) => url.endsWith('/oauth/jwks')))
  })

  test('empty issuer JWKS + getSession 401 rejects (not soft-anon)', async () => {
    const did = 'did:plc:rejected-alice'
    const issuer = 'https://bsky.social'
    const path = '/xrpc/org.opencommunitynotes.getProposals'
    const { accessToken, dpopProof } = await mintDpopAccess(
      did,
      issuer,
      'GET',
      `http://notes.test${path}`,
    )

    const fetchFn = async (input: string | URL): Promise<Response> => {
      const url = String(input)
      if (url.includes('oauth-authorization-server')) {
        return jsonResponse(200, { jwks_uri: `${issuer}/oauth/jwks` })
      }
      if (url.endsWith('/oauth/jwks')) {
        return jsonResponse(200, { keys: [] })
      }
      if (url.includes('com.atproto.server.getSession')) {
        return new Response('AuthenticationRequired', { status: 401 })
      }
      throw new Error(`Unexpected fetch: ${url}`)
    }

    const result = await verifyDpopBoundAccessToken(
      {
        headers: {
          authorization: `DPoP ${accessToken}`,
          dpop: dpopProof,
          host: 'notes.test',
        },
        method: 'GET',
        url: path,
        protocol: 'http',
      },
      accessToken,
      { fetchFn, defaultPdsUrl: issuer },
    )

    assert.strictEqual(result.success, false)
    assert.notStrictEqual(result.missing, true)
    assert.strictEqual(getProposalsAuthMode(result), 'reject')
    assert.match(result.error || '', /getSession returned 401/)
  })

  test('populated JWKS path does not call getSession', async () => {
    const did = 'did:plc:jwks-only-alice'
    const issuer = 'https://pds.example'
    const { accessToken, dpopProof, asJwk } = await mintDpopAccess(
      did,
      issuer,
      'GET',
      'http://notes.test/xrpc/org.opencommunitynotes.getProposals',
    )

    const fetchFn = async (input: string | URL): Promise<Response> => {
      const url = String(input)
      if (url.includes('oauth-authorization-server')) {
        return jsonResponse(200, { jwks_uri: `${issuer}/oauth/jwks` })
      }
      if (url.endsWith('/oauth/jwks')) {
        return jsonResponse(200, { keys: [asJwk] })
      }
      if (url.includes('getSession')) {
        throw new Error('getSession must not run when issuer JWKS has keys')
      }
      throw new Error(`Unexpected fetch: ${url}`)
    }

    const result = await verifyDpopBoundAccessToken(
      {
        headers: {
          authorization: `DPoP ${accessToken}`,
          dpop: dpopProof,
          host: 'notes.test',
        },
        method: 'GET',
        url: '/xrpc/org.opencommunitynotes.getProposals',
        protocol: 'http',
      },
      accessToken,
      {
        fetchFn,
        resolvePdsUrl: async () => {
          throw new Error('DID resolution must not run on JWKS path')
        },
        defaultPdsUrl: 'https://unused.example',
      },
    )

    assert.strictEqual(result.success, true, result.error)
    assert.strictEqual(result.did, did)
  })

  test('populated JWKS with invalid signature rejects without getSession', async () => {
    const did = 'did:plc:bad-sig-alice'
    const issuer = 'https://pds.example'
    const { accessToken, dpopProof } = await mintDpopAccess(
      did,
      issuer,
      'GET',
      'http://notes.test/xrpc/org.opencommunitynotes.getProposals',
    )
    const other = await mintDpopAccess(
      did,
      issuer,
      'GET',
      'http://notes.test/xrpc/org.opencommunitynotes.getProposals',
    )

    let getSessionCalls = 0
    const fetchFn = async (input: string | URL): Promise<Response> => {
      const url = String(input)
      if (url.includes('oauth-authorization-server')) {
        return jsonResponse(200, { jwks_uri: `${issuer}/oauth/jwks` })
      }
      if (url.endsWith('/oauth/jwks')) {
        return jsonResponse(200, { keys: [other.asJwk] })
      }
      if (url.includes('getSession')) {
        getSessionCalls += 1
        throw new Error('getSession must not run when JWKS verify fails')
      }
      throw new Error(`Unexpected fetch: ${url}`)
    }

    const result = await verifyDpopBoundAccessToken(
      {
        headers: {
          authorization: `DPoP ${accessToken}`,
          dpop: dpopProof,
          host: 'notes.test',
        },
        method: 'GET',
        url: '/xrpc/org.opencommunitynotes.getProposals',
        protocol: 'http',
      },
      accessToken,
      { fetchFn, defaultPdsUrl: issuer },
    )

    assert.strictEqual(result.success, false)
    assert.notStrictEqual(result.missing, true)
    assert.strictEqual(getSessionCalls, 0)
    assert.match(result.error || '', /JWT verification failed/)
  })

  test('AuthService empty JWKS uses identity PDS then getSession', async () => {
    const jwtDid = 'did:plc:auth-service-alice'
    const sessionDid = 'did:plc:from-session'
    const issuer = 'https://bsky.social'
    const identityPds = 'https://morel.example'
    const path = '/xrpc/org.opencommunitynotes.getProposals'
    const { accessToken, dpopProof } = await mintDpopAccess(
      jwtDid,
      issuer,
      'GET',
      `https://api.bluenotes.social${path}`,
    )

    let getSessionCalls = 0
    const fetchFn = async (
      input: string | URL,
      init?: RequestInit,
    ): Promise<Response> => {
      const url = String(input)
      if (url.includes('oauth-authorization-server') || url.endsWith('/oauth/jwks')) {
        if (url.endsWith('/oauth/jwks')) {
          return jsonResponse(200, { keys: [] })
        }
        return jsonResponse(200, { jwks_uri: `${issuer}/oauth/jwks` })
      }
      if (url.includes('com.atproto.server.getSession')) {
        getSessionCalls += 1
        assert.strictEqual(
          url,
          `${identityPds}/xrpc/com.atproto.server.getSession`,
        )
        const headers = headersFromInit(init)
        assert.strictEqual(headers.authorization, `DPoP ${accessToken}`)
        assert.strictEqual(headers.dpop, dpopProof)
        return jsonResponse(200, { did: sessionDid })
      }
      throw new Error(`Unexpected fetch: ${url}`)
    }

    const auth = new AuthService('http://localhost:2583', {
      fetchFn,
      publicUrl: 'https://api.bluenotes.social',
      resolvePdsUrl: async (did) => {
        assert.strictEqual(did, jwtDid)
        return identityPds
      },
    })

    const result = await auth.verifyAuthHeader({
      headers: {
        authorization: `DPoP ${accessToken}`,
        dpop: dpopProof,
        host: '127.0.0.1:8080',
      },
      method: 'GET',
      url: path,
      protocol: 'http',
    })

    assert.strictEqual(result.success, true, result.error)
    assert.strictEqual(result.did, sessionDid)
    assert.strictEqual(result.scheme, 'dpop')
    assert.strictEqual(getSessionCalls, 1)
    assert.strictEqual(getProposalsAuthMode(result), 'authed')
  })
}

function headersFromInit(
  init?: RequestInit,
): Record<string, string | undefined> {
  const raw = init?.headers
  if (!raw) return {}
  if (raw instanceof Headers) {
    return {
      authorization: raw.get('authorization') ?? raw.get('Authorization') ?? undefined,
      dpop: raw.get('dpop') ?? raw.get('DPoP') ?? undefined,
    }
  }
  if (Array.isArray(raw)) {
    const map: Record<string, string | undefined> = {}
    for (const [key, value] of raw) {
      map[key.toLowerCase()] = value
    }
    return map
  }
  const map: Record<string, string | undefined> = {}
  for (const [key, value] of Object.entries(raw)) {
    map[key.toLowerCase()] = value
  }
  return map
}

function headerOrThrow(req: AuthRequest, name: string): string {
  const value = req.headers[name]
  if (typeof value !== 'string') {
    throw new Error(`missing header ${name}`)
  }
  return value
}

async function mintDpopAccess(
  did: string,
  issuer: string,
  method: string,
  htu: string,
) {
  const { privateKey: dpopPriv, publicKey: dpopPub } =
    await generateKeyPair('ES256')
  const dpopJwk = await exportJWK(dpopPub)
  dpopJwk.alg = 'ES256'
  const jkt = await calculateJwkThumbprint(dpopJwk)

  const { privateKey: asPriv, publicKey: asPub } =
    await generateKeyPair('ES256')
  const asJwk = await exportJWK(asPub)
  asJwk.kid = 'as-key-1'
  asJwk.alg = 'ES256'
  asJwk.use = 'sig'

  const accessToken = await new SignJWT({
    sub: did,
    iss: issuer,
    aud: 'did:web:pds.example',
    scope: 'atproto',
    cnf: { jkt },
  })
    .setProtectedHeader({ alg: 'ES256', kid: 'as-key-1', typ: 'at+jwt' })
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(asPriv)

  const ath = createHash('sha256').update(accessToken).digest('base64url')
  const dpopProof = await new SignJWT({
    jti: 'proof-1',
    htm: method,
    htu,
    ath,
  })
    .setProtectedHeader({ alg: 'ES256', typ: 'dpop+jwt', jwk: dpopJwk })
    .setIssuedAt()
    .sign(dpopPriv)

  return { accessToken, dpopProof, asJwk }
}
