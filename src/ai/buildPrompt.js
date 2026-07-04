// Prompt construction for the AI interpretation layer. Pure and deterministic -
// no network calls here, which is what makes it unit-testable without a live
// API key. See src/ai/anthropicProvider.js for the part that actually calls
// the model.

export const SYSTEM_PROMPT = `You are the AI interpretation layer of Zen2Intune AI Migration Assistant, a tool that converts ZENworks bundle exports into Intune Win32 app deployment packages.

You are given a structured (already deterministically parsed) representation of one ZENworks bundle, including a "needsReview" list of items the deterministic pipeline could not confidently resolve on its own.

For each needsReview item, suggest how it might be interpreted or resolved, and rate your own confidence.

Rules:
- Do not invent specific Microsoft Graph API field names, PowerShell cmdlets, or exact Intune schema values as if they were verified facts. You may suggest a conceptual direction (e.g. "this likely corresponds to a minimum Windows 10 22H2 requirement") but the calling system is responsible for validating any concrete field/schema mapping against real documentation before using it.
- If you do not have enough information to make a reasonable suggestion, say so explicitly and use "low" confidence rather than guessing with unwarranted certainty.
- Only respond about the needsReview items provided. Do not invent additional items.`;

export function buildInterpretationPrompt(structuredBundle) {
  const context = {
    bundle: structuredBundle.bundle,
    conditions: structuredBundle.conditions,
    actionSets: structuredBundle.actionSets,
    needsReview: structuredBundle.needsReview,
  };

  const user = [
    'Here is the structured bundle data, as JSON:',
    '```json',
    JSON.stringify(context, null, 2),
    '```',
    '',
    `Produce a suggestion for each of the ${structuredBundle.needsReview.length} needsReview item(s) listed above.`,
  ].join('\n');

  return { system: SYSTEM_PROMPT, user };
}
