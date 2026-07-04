# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Zen2Intune AI Migration Assistant converts ZENworks bundle exports (XML) into Intune
Win32 app deployment packages. It parses ZENworks bundles to extract install actions,
scripts, conditions, and dependencies, then produces Intune-ready detection rules,
requirement rules, install/uninstall commands, and return codes.

## Architecture

The pipeline is a strict one-way flow through four stages. Each stage's output is the
next stage's only input — do not let later stages reach back into earlier raw data.

1. **Parser engine** (deterministic, no AI): reads ZENworks bundle XML exports and
   extracts install actions, scripts, conditions, and dependencies. Pure, rule-based
   parsing — no LLM calls, no inference, no guessing at meaning. If the XML is
   ambiguous or malformed, the parser must fail loudly or flag the record, never
   silently produce a best-guess structure.
2. **Structured JSON**: the canonical intermediate representation of a parsed bundle.
   This schema is the contract between the deterministic parser and everything
   downstream. Changes to this schema affect every later phase.
3. **AI interpretation layer**: consumes structured JSON to make judgment calls the
   deterministic parser can't (e.g., mapping ambiguous ZENworks constructs to Intune
   equivalents, summarizing intent). This is the only stage where AI/LLM reasoning is
   permitted.
4. **Intune output generator**: converts the (optionally AI-annotated) structured JSON
   into final Intune Win32 app packages — detection rules, requirement rules,
   install/uninstall commands, return codes.

Keep parsing (stage 1) and interpretation (stage 3) strictly separated: the parser
never guesses, and the AI layer never touches raw XML directly.

## Tech Stack

- Node.js backend
- Plain JS/TS for the parser (no framework decisions locked in yet — don't assume
  Express, NestJS, a specific test runner, or a specific XML library until a choice
  is made and documented here)

## Coding Rules

- **Never fabricate PowerShell cmdlets, Graph API fields, or Intune schema
  properties.** If a cmdlet, field, or API shape isn't verified against real
  documentation, do not invent one that merely looks plausible.
- **Flag uncertainty instead of guessing.** When a ZENworks construct has no clear
  Intune equivalent, or an XML field's meaning is ambiguous, surface it explicitly
  (e.g., a `needsReview` flag or warning in the output) rather than silently choosing
  an interpretation.
- **No placeholder logic pretending to be real.** Don't write stub functions that
  return fake-but-plausible data as if they were fully implemented. If something
  isn't built yet, it should be visibly absent or explicitly marked TODO, not
  disguised as working code.

## Phase Plan

Work proceeds in order; do not start a phase until the previous phase has a passing
runnable test.

1. **Phase 1 — XML parser**: parse ZENworks bundle XML exports into raw extracted data
   (install actions, scripts, conditions, dependencies).
2. **Phase 2 — Structured JSON schema**: define and validate the canonical
   intermediate JSON representation.
3. **Phase 3 — Intune conversion engine**: convert structured JSON into Intune Win32
   app deployment packages.
4. **Phase 4 — AI interpretation layer**: add AI-driven interpretation for ambiguous
   or judgment-requiring mappings.
5. **Phase 5 — Dashboard**: build the user-facing interface over the pipeline.

## Testing Rule

Every phase must have a runnable test demonstrating it works before moving to the next
phase. No phase is "done" until its test passes.
