import Graphemer from 'graphemer'

/**
 * Community Notes constants (matching X/Twitter standard)
 * URLs are counted as 1 character regardless of their actual length
 */
const COMMUNITY_NOTES_MAX_LENGTH = 280
const URL_LENGTH = 1
const URL_START_REGEX = /https?:\/\/\S*/gi

/**
 * Calculate the display length of a note with URLs counted as 1 character each.
 * This matches the frontend validation logic exactly.
 * 
 * @param text - The note text to validate
 * @returns The counted length (with URLs as 1 char each)
 */
function calculateNoteLength(text: string): number {
  const graphemer = new Graphemer()
  
  // Find all URL-like patterns (including incomplete ones like "https://")
  const urlMatches = text.match(URL_START_REGEX) || []
  
  // Replace each URL pattern with a placeholder of URL_LENGTH characters
  let processedText = text
  urlMatches.forEach(url => {
    processedText = processedText.replaceAll(url, 'x'.repeat(URL_LENGTH))
  })
  
  return graphemer.countGraphemes(processedText)
}

/**
 * Validate that a note text meets the length requirement.
 * Returns true if valid, false if too long.
 * 
 * @param text - The note text to validate
 * @returns true if within limit, false if exceeds limit
 */
export function isValidNoteLength(text: string): boolean {
  return calculateNoteLength(text) <= COMMUNITY_NOTES_MAX_LENGTH
}

/**
 * Validate note text and throw error if invalid.
 * Use this in your API endpoint.
 * 
 * @param text - The note text to validate
 * @throws Error if validation fails
 */
export function validateNoteText(text: string): void {
  const length = calculateNoteLength(text)
  if (length > COMMUNITY_NOTES_MAX_LENGTH) {
    throw new Error(
      `Note text cannot exceed ${COMMUNITY_NOTES_MAX_LENGTH} characters ` +
      `(currently ${length} characters, counting URLs as 1 character each)`
    )
  }
}
