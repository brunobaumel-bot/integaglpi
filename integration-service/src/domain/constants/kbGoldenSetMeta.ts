/**
 * KB Golden Set metadata constants — shared between src/ and tests/.
 *
 * Single source of truth for version, count, and phase metadata.
 * Consumed by KbEffectivenessService (src/) and kbGoldenSetFixtures (tests/).
 *
 * Phase: integaglpi_v9_kb_quality_001 — F2.1 / F2.4
 */

export const KB_GOLDEN_SET_META = {
  version: '1.0.0',
  phase: 'integaglpi_v9_kb_quality_001',
  deliverable: 'F2.1',
  total_queries: 50,
  g06_queries: 17,
  expansion_queries: 33,
} as const;
