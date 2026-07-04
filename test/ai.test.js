import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildInterpretationPrompt, SYSTEM_PROMPT } from '../src/ai/buildPrompt.js';
import { parseInterpretationResponse, AiResponseParseError } from '../src/ai/parseResponse.js';
import { interpretBundle, isConfigured, AiProviderNotConfiguredError } from '../src/ai/anthropicProvider.js';

const sampleStructuredBundle = {
  schemaVersion: '1.0.0',
  bundle: { name: 'Sample App', guid: 'g', type: 'Install', version: '1.0.0' },
  conditions: [
    { kind: 'OperatingSystem', operator: 'greaterOrEqual', value: 'Windows10', recognized: true, sourcePath: '/x' },
  ],
  dependencies: [],
  actionSets: [],
  needsReview: [
    { code: 'os_condition_needs_manual_mapping', message: 'needs a human', path: '/x', severity: 'warning' },
  ],
};

test('buildInterpretationPrompt embeds bundle data and instructs against fabrication', () => {
  const { system, user } = buildInterpretationPrompt(sampleStructuredBundle);
  assert.equal(system, SYSTEM_PROMPT);
  assert.match(system, /Do not invent/);
  assert.match(user, /os_condition_needs_manual_mapping/);
  assert.match(user, /Sample App/);
  assert.match(user, /Produce a suggestion for each of the 1 needsReview/);
});

test('parseInterpretationResponse accepts a well-formed annotation payload', () => {
  const raw = JSON.stringify({
    annotations: [
      {
        needsReviewCode: 'os_condition_needs_manual_mapping',
        path: '/x',
        suggestedMapping: 'Possibly Windows10_21H2, but verify against real Intune values',
        confidence: 'low',
        rationale: 'ZENworks value "Windows10" is too coarse to map exactly.',
      },
    ],
  });

  const annotations = parseInterpretationResponse(raw);
  assert.equal(annotations.length, 1);
  assert.equal(annotations[0].confidence, 'low');
});

test('parseInterpretationResponse rejects invalid JSON', () => {
  assert.throws(() => parseInterpretationResponse('not json'), AiResponseParseError);
});

test('parseInterpretationResponse rejects a missing annotations array', () => {
  assert.throws(() => parseInterpretationResponse(JSON.stringify({ foo: 'bar' })), AiResponseParseError);
});

test('parseInterpretationResponse rejects an annotation missing required fields', () => {
  const raw = JSON.stringify({ annotations: [{ needsReviewCode: 'x' }] });
  assert.throws(() => parseInterpretationResponse(raw), AiResponseParseError);
});

test('parseInterpretationResponse rejects an invalid confidence value', () => {
  const raw = JSON.stringify({
    annotations: [{ needsReviewCode: 'x', path: '/x', suggestedMapping: 'y', confidence: 'certain', rationale: 'z' }],
  });
  assert.throws(() => parseInterpretationResponse(raw), AiResponseParseError);
});

test('interpretBundle short-circuits with no annotations when there is nothing to review, without requiring configuration', async () => {
  const bundleWithNoReview = { ...sampleStructuredBundle, needsReview: [] };
  const result = await interpretBundle(bundleWithNoReview);
  assert.deepEqual(result, { annotations: [] });
});

test('interpretBundle throws AiProviderNotConfiguredError when no credentials are available', async () => {
  // This environment has no ANTHROPIC_API_KEY and no `ant auth login` profile,
  // so this exercises the real (not mocked) not-configured path.
  assert.equal(isConfigured(), false);
  await assert.rejects(() => interpretBundle(sampleStructuredBundle), AiProviderNotConfiguredError);
});

test('interpretBundle wires prompt building and response parsing through an injected client', async () => {
  const fakeAnnotation = {
    needsReviewCode: 'os_condition_needs_manual_mapping',
    path: '/x',
    suggestedMapping: 'Likely Windows 10, exact release unverified',
    confidence: 'low',
    rationale: 'Source value lacks a specific release identifier.',
  };

  let capturedRequest = null;
  const fakeClient = {
    messages: {
      create: async (request) => {
        capturedRequest = request;
        return {
          content: [{ type: 'text', text: JSON.stringify({ annotations: [fakeAnnotation] }) }],
          usage: { input_tokens: 10, output_tokens: 5 },
        };
      },
    },
  };

  const result = await interpretBundle(sampleStructuredBundle, { client: fakeClient });

  assert.deepEqual(result.annotations, [fakeAnnotation]);
  assert.equal(capturedRequest.output_config.format.type, 'json_schema');
  assert.match(capturedRequest.system, /Do not invent/);
  assert.match(capturedRequest.messages[0].content, /os_condition_needs_manual_mapping/);
});
