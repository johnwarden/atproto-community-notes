import assert from 'node:assert'
import { describe, test } from 'node:test'
import { isValidNoteLength, validateNoteText } from '../src/validation/note-length'

describe('Note Length Validation', () => {
  test('✅ Simple text within limit should pass', () => {
    const text = 'This is a simple note.'
    assert.strictEqual(isValidNoteLength(text), true)
    assert.doesNotThrow(() => validateNoteText(text))
  })

  test('✅ Text with URL (URL counts as 1 char)', () => {
    const text = 'Check this out: https://example.com/very/long/path/to/something'
    // Should count as ~20 characters (text + 1 for URL), not 60+
    assert.strictEqual(isValidNoteLength(text), true)
    assert.doesNotThrow(() => validateNoteText(text))
  })

  test('✅ Multiple URLs (each counts as 1 char)', () => {
    const text = 'Source 1: https://example.com/long/url and Source 2: https://another-example.com/path'
    // Should count each URL as 1 character
    assert.strictEqual(isValidNoteLength(text), true)
    assert.doesNotThrow(() => validateNoteText(text))
  })

  test('✅ Text exactly at 280 character limit should pass', () => {
    // 278 chars + 1 space + 1 URL = 280 total
    const text = 'a'.repeat(278) + ' https://example.com'
    assert.strictEqual(isValidNoteLength(text), true)
    assert.doesNotThrow(() => validateNoteText(text))
  })

  test('✅ Text at limit with only text (no URLs)', () => {
    const text = 'a'.repeat(280)
    assert.strictEqual(isValidNoteLength(text), true)
    assert.doesNotThrow(() => validateNoteText(text))
  })

  test('❌ Text over 280 character limit should fail', () => {
    // 279 chars + 1 space + 1 URL = 281 total
    const text = 'a'.repeat(279) + ' https://example.com'
    assert.strictEqual(isValidNoteLength(text), false)
    
    assert.throws(
      () => validateNoteText(text),
      /Note text cannot exceed 280 characters/,
    )
  })

  test('❌ Text over limit without URLs should fail', () => {
    const text = 'a'.repeat(281)
    assert.strictEqual(isValidNoteLength(text), false)
    
    assert.throws(
      () => validateNoteText(text),
      /Note text cannot exceed 280 characters/,
    )
  })

  test('✅ URL at beginning of text', () => {
    const text = 'https://example.com/very/long/path/to/resource followed by some text'
    assert.strictEqual(isValidNoteLength(text), true)
    assert.doesNotThrow(() => validateNoteText(text))
  })

  test('✅ URL at end of text', () => {
    const text = 'Some text followed by https://example.com/very/long/path/to/resource'
    assert.strictEqual(isValidNoteLength(text), true)
    assert.doesNotThrow(() => validateNoteText(text))
  })

  test('✅ HTTP and HTTPS URLs both count as 1 char', () => {
    const text = 'HTTP: http://example.com/path and HTTPS: https://example.com/path'
    assert.strictEqual(isValidNoteLength(text), true)
    assert.doesNotThrow(() => validateNoteText(text))
  })

  test('✅ Incomplete URL patterns (like "https://") are counted', () => {
    const text = 'Incomplete: https://'
    assert.strictEqual(isValidNoteLength(text), true)
    assert.doesNotThrow(() => validateNoteText(text))
  })

  test('✅ Emoji and Unicode characters counted correctly', () => {
    // Emoji should count as 1 grapheme
    const text = '👍👍👍 This has emoji'
    assert.strictEqual(isValidNoteLength(text), true)
    assert.doesNotThrow(() => validateNoteText(text))
  })

  test('✅ Complex Unicode (family emoji) counted correctly', () => {
    // Family emoji is a single grapheme but multiple codepoints
    const text = '👨‍👩‍👧‍👦 Family emoji plus text'
    assert.strictEqual(isValidNoteLength(text), true)
    assert.doesNotThrow(() => validateNoteText(text))
  })

  test('❌ Error message includes character count and URL note', () => {
    const text = 'a'.repeat(281)
    
    try {
      validateNoteText(text)
      assert.fail('Should have thrown an error')
    } catch (error) {
      const message = (error as Error).message
      assert.ok(message.includes('280 characters'), 'Should mention limit')
      assert.ok(message.includes('281 characters'), 'Should mention current count')
      assert.ok(message.includes('counting URLs as 1 character'), 'Should mention URL counting')
    }
  })

  test('✅ Very long text with many URLs stays within limit', () => {
    // Each URL counts as 1, so we can fit many URLs
    const urls = Array(10).fill('https://example.com/very/long/path').join(' ')
    // 10 URLs = 10 chars + 9 spaces = 19 chars
    const remainingSpace = 280 - 19
    const text = 'a'.repeat(remainingSpace) + ' ' + urls.split(' ').slice(0, 9).join(' ')
    assert.strictEqual(isValidNoteLength(text), true)
  })

  test('✅ URL with query parameters and fragments', () => {
    const text = 'Check this: https://example.com/path?query=value&other=param#fragment'
    assert.strictEqual(isValidNoteLength(text), true)
    assert.doesNotThrow(() => validateNoteText(text))
  })

  test('✅ URL with port numbers', () => {
    const text = 'Local server: http://localhost:3000/api/endpoint'
    assert.strictEqual(isValidNoteLength(text), true)
    assert.doesNotThrow(() => validateNoteText(text))
  })

  test('✅ Multiple URLs on separate lines', () => {
    const text = 'First: https://example.com\nSecond: https://another.com'
    assert.strictEqual(isValidNoteLength(text), true)
    assert.doesNotThrow(() => validateNoteText(text))
  })

  test('✅ Empty string should pass', () => {
    // Note: API validation requires non-empty text, but length validation alone allows it
    const text = ''
    assert.strictEqual(isValidNoteLength(text), true)
    assert.doesNotThrow(() => validateNoteText(text))
  })
})

