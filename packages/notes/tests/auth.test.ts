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
import { verifyDpopBoundAccessToken } from '../src/auth-dpop'
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

    const fetchFn = async (input: RequestInfo | URL): Promise<Response> => {
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

    const fetchFn = async (input: RequestInfo | URL): Promise<Response> => {
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
})

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
