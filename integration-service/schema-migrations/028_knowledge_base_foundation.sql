CREATE TABLE IF NOT EXISTS public.glpi_plugin_integaglpi_kb_articles (
  id BIGSERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  content_text TEXT NOT NULL,
  article_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  category TEXT NULL,
  service_catalog_id BIGINT NULL,
  routing_queue_id BIGINT NULL,
  tags JSONB NOT NULL DEFAULT '[]'::jsonb,
  is_sensitive BOOLEAN NOT NULL DEFAULT FALSE,
  version INTEGER NOT NULL DEFAULT 1,
  created_by_glpi_user_id BIGINT NOT NULL,
  updated_by_glpi_user_id BIGINT NULL,
  published_by_glpi_user_id BIGINT NULL,
  archived_by_glpi_user_id BIGINT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  published_at TIMESTAMPTZ NULL,
  archived_at TIMESTAMPTZ NULL,
  CONSTRAINT glpi_integaglpi_kb_articles_type_chk CHECK (
    article_type IN (
      'procedimento_tecnico',
      'solucao_comum',
      'resposta_padrao',
      'diagnostico_conhecido',
      'faq_interno',
      'alerta_operacional'
    )
  ),
  CONSTRAINT glpi_integaglpi_kb_articles_status_chk CHECK (status IN ('draft', 'active', 'archived'))
);

CREATE TABLE IF NOT EXISTS public.glpi_plugin_integaglpi_kb_article_versions (
  id BIGSERIAL PRIMARY KEY,
  article_id BIGINT NOT NULL,
  version INTEGER NOT NULL,
  title TEXT NOT NULL,
  content_text TEXT NOT NULL,
  article_type TEXT NOT NULL,
  status TEXT NOT NULL,
  tags_snapshot JSONB NOT NULL DEFAULT '[]'::jsonb,
  is_sensitive BOOLEAN NOT NULL DEFAULT FALSE,
  changed_by_glpi_user_id BIGINT NOT NULL,
  change_reason TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT glpi_integaglpi_kb_versions_type_chk CHECK (
    article_type IN (
      'procedimento_tecnico',
      'solucao_comum',
      'resposta_padrao',
      'diagnostico_conhecido',
      'faq_interno',
      'alerta_operacional'
    )
  ),
  CONSTRAINT glpi_integaglpi_kb_versions_status_chk CHECK (status IN ('draft', 'active', 'archived'))
);

CREATE UNIQUE INDEX IF NOT EXISTS glpi_integaglpi_kb_versions_article_version_uq
  ON public.glpi_plugin_integaglpi_kb_article_versions (article_id, version);

CREATE INDEX IF NOT EXISTS glpi_integaglpi_kb_articles_status_idx
  ON public.glpi_plugin_integaglpi_kb_articles (status);

CREATE INDEX IF NOT EXISTS glpi_integaglpi_kb_articles_type_idx
  ON public.glpi_plugin_integaglpi_kb_articles (article_type);

CREATE INDEX IF NOT EXISTS glpi_integaglpi_kb_articles_category_idx
  ON public.glpi_plugin_integaglpi_kb_articles (category);

CREATE INDEX IF NOT EXISTS glpi_integaglpi_kb_articles_service_idx
  ON public.glpi_plugin_integaglpi_kb_articles (service_catalog_id);

CREATE INDEX IF NOT EXISTS glpi_integaglpi_kb_articles_queue_idx
  ON public.glpi_plugin_integaglpi_kb_articles (routing_queue_id);

CREATE INDEX IF NOT EXISTS glpi_integaglpi_kb_articles_created_idx
  ON public.glpi_plugin_integaglpi_kb_articles (created_at DESC);

CREATE INDEX IF NOT EXISTS glpi_integaglpi_kb_articles_updated_idx
  ON public.glpi_plugin_integaglpi_kb_articles (updated_at DESC);

CREATE INDEX IF NOT EXISTS glpi_integaglpi_kb_articles_title_idx
  ON public.glpi_plugin_integaglpi_kb_articles (lower(title));

CREATE INDEX IF NOT EXISTS glpi_integaglpi_kb_articles_tags_gin_idx
  ON public.glpi_plugin_integaglpi_kb_articles USING GIN (tags);

CREATE INDEX IF NOT EXISTS glpi_integaglpi_kb_versions_article_created_idx
  ON public.glpi_plugin_integaglpi_kb_article_versions (article_id, created_at DESC);
