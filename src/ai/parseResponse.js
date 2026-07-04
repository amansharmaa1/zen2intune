// Parses and validates the AI provider's JSON response into our annotation
// shape. Pure - no network here either, so it's testable with canned strings.

export class AiResponseParseError extends Error {
  constructor(message) {
    super(message);
    this.name = 'AiResponseParseError';
  }
}

const REQUIRED_FIELDS = ['needsReviewCode', 'path', 'suggestedMapping', 'confidence', 'rationale'];
const VALID_CONFIDENCE = new Set(['low', 'medium', 'high']);

export function parseInterpretationResponse(rawText) {
  let parsed;
  try {
    parsed = JSON.parse(rawText);
  } catch (err) {
    throw new AiResponseParseError(`AI response was not valid JSON: ${err.message}`);
  }

  if (!parsed || !Array.isArray(parsed.annotations)) {
    throw new AiResponseParseError('AI response JSON did not contain an "annotations" array');
  }

  parsed.annotations.forEach((item, index) => {
    const missing = REQUIRED_FIELDS.filter((key) => !(key in item));
    if (missing.length > 0) {
      throw new AiResponseParseError(`annotations[${index}] missing field(s): ${missing.join(', ')}`);
    }
    if (!VALID_CONFIDENCE.has(item.confidence)) {
      throw new AiResponseParseError(
        `annotations[${index}].confidence "${item.confidence}" is not one of low/medium/high`,
      );
    }
  });

  return parsed.annotations;
}
