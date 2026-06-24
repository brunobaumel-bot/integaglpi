-- 051_kb_candidates_add_source_tier.sql
--
-- D02 (integaglpi_v9_hml_operational_defects_fix_001):
-- O card "KB Quality" do Hub Operacional (KbEffectivenessService) consulta
-- COALESCE(c.source_tier, ...) em glpi_plugin_integaglpi_kb_candidates, mas a
-- coluna nunca foi criada por migration — em HML a query falha com
-- "column c.source_tier does not exist".
--
-- Migration IDEMPOTENTE e ADITIVA, em tabela própria da integração (nunca core
-- GLPI). Coluna nullable sem default obrigatório: artigos sem classificação
-- caem no fallback 'tier_3_generic_playbook' via COALESCE na leitura.
--
-- Tiers válidos (contrato V9 KB Quality):
--   tier_1_product_specific | tier_2_operational_kb |
--   tier_3_generic_playbook | tier_4_automation_scripts

ALTER TABLE glpi_plugin_integaglpi_kb_candidates
  ADD COLUMN IF NOT EXISTS source_tier TEXT NULL;

COMMENT ON COLUMN glpi_plugin_integaglpi_kb_candidates.source_tier IS
  'Classificação de especificidade do artigo (tier_1_product_specific..tier_4_automation_scripts). NULL = tier_3_generic_playbook via COALESCE na leitura.';

CREATE INDEX IF NOT EXISTS glpi_intega_kb_candidates_source_tier_idx
  ON glpi_plugin_integaglpi_kb_candidates (source_tier)
  WHERE source_tier IS NOT NULL;
