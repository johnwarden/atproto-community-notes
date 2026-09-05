import assert from 'node:assert'
import { describe, test } from 'node:test'
import { type ServerEnvironment, envToCfg, parsePublicUrl } from '../src/config'

function baseEnv(
  overrides: Partial<ServerEnvironment> = {},
): ServerEnvironment {
  return {
    port: 2595,
    internalApiPort: 2596,
    dbPath: '/tmp/notes.db',
    pdsUrl: 'http://localhost:2583',
    aidSalt: 'test-salt',
    repoAccountDid: 'did:plc:repo',
    repoAccountPassword: 'pw',
    feedgenDocumentDid: 'did:web:notes.test',
    labelerDid: 'did:plc:labeler',
    labelerUrl: 'http://localhost:2597',
    ...overrides,
  }
}

describe('parsePublicUrl / PUBLIC_URL', () => {
  test('normalizes to origin and strips trailing slash', () => {
    assert.strictEqual(
      parsePublicUrl('https://api.bluenotes.social/'),
      'https://api.bluenotes.social',
    )
    assert.strictEqual(
      parsePublicUrl('http://localhost:2595'),
      'http://localhost:2595',
    )
  })

  test('unset or empty is undefined (local/dev fallback)', () => {
    assert.strictEqual(parsePublicUrl(undefined), undefined)
    assert.strictEqual(parsePublicUrl(''), undefined)
    assert.strictEqual(parsePublicUrl('   '), undefined)
  })

  test('rejects non-http(s) values', () => {
    assert.throws(() => parsePublicUrl('ftp://notes.example'), /http or https/)
    assert.throws(() => parsePublicUrl('not-a-url'), /valid URL/)
  })

  test('envToCfg maps PUBLIC_URL onto AuthService publicUrl (not pdsUrl)', () => {
    const cfg = envToCfg(
      baseEnv({
        pdsUrl: 'https://pds.example',
        publicUrl: 'https://api.bluenotes.social/',
      }),
    )
    assert.strictEqual(cfg.pdsUrl, 'https://pds.example')
    assert.strictEqual(cfg.publicUrl, 'https://api.bluenotes.social')
    assert.notStrictEqual(cfg.publicUrl, cfg.pdsUrl)
  })

  test('envToCfg omits publicUrl when PUBLIC_URL is unset', () => {
    const cfg = envToCfg(baseEnv())
    assert.strictEqual(cfg.publicUrl, undefined)
    assert.strictEqual(cfg.pdsUrl, 'http://localhost:2583')
  })
})
