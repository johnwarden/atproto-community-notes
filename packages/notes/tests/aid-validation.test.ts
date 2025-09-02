import { test, describe } from 'node:test'
import assert from 'node:assert'
import { generateAid } from '../src/utils'

// Helper function for AID format validation
function isValidAid(aid: string): boolean {
  const aidRegex = /^[a-z2-7]{24}$/
  return typeof aid === 'string' && aidRegex.test(aid)
}

describe('AID Generation', () => {
  const testUserDid = 'did:plc:test-user-123'
  const testServiceDid = 'did:web:org.opencommunitynotes'
  const testServicePrivateKey = 'test-service-private-key-for-aid-generation'

  describe('generateAid', () => {
    test('should generate consistent AIDs for same inputs', () => {
      const aid1 = generateAid(testUserDid, testServicePrivateKey)
      const aid2 = generateAid(testUserDid, testServicePrivateKey)

      assert.strictEqual(aid1, aid2)
      assert.ok(isValidAid(aid1), `Expected ${aid1} to be a valid AID`)
      assert.strictEqual(aid1.length, 24)
    })

    test('should generate different AIDs for different users', () => {
      const user1Aid = generateAid('did:plc:user1', testServicePrivateKey)
      const user2Aid = generateAid('did:plc:user2', testServicePrivateKey)

      assert.notStrictEqual(user1Aid, user2Aid)
      assert.ok(isValidAid(user1Aid), `Expected ${user1Aid} to be a valid AID`)
      assert.ok(isValidAid(user2Aid), `Expected ${user2Aid} to be a valid AID`)
    })

    test('should generate different AIDs for different service private keys', () => {
      const key1Aid = generateAid(testUserDid, testServicePrivateKey)
      const key2Aid = generateAid(testServiceDid, testServicePrivateKey)

      assert.notStrictEqual(key1Aid, key2Aid)
      assert.ok(isValidAid(key1Aid), `Expected ${key1Aid} to be a valid AID`)
      assert.ok(isValidAid(key2Aid), `Expected ${key2Aid} to be a valid AID`)
    })
  })
})
