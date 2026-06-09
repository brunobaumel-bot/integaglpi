/**
 * KB Golden Set — Fase 2A (F2.1)
 *
 * 50 queries reais cobrindo os principais produtos e cenários atendidos.
 * As primeiras 17 entradas correspondem diretamente ao G0.6 (kbSearchPlanner.test.ts).
 *
 * Invariants:
 *   - source_tier usa apenas valores do enum SourceTier real (KbSearchPlannerService.ts)
 *   - min_confidence é o threshold mínimo que o planner DEVE produzir
 *   - forbidden: termos que NÃO devem aparecer no normalizedQuery/mustTerms
 *   - primary_kb: slug documental — referência para telemetria RAGAS, não para assert exato do gate
 *
 * Phase: integaglpi_v9_kb_quality_001 — F2.1
 */

import type { SourceTier } from '../../src/domain/services/KbSearchPlannerService.js';

export interface GoldenSetQuery {
  /** Identificador único do caso — usado em relatórios RAGAS. */
  id: string;
  /** Query real de técnico ou usuário, como seria digitada no painel Smart Help. */
  query: string;
  /** Contexto opcional de cliente (produto detectado upstream). */
  clientContext?: { productOrSystem?: string; category?: string } | null;
  expected: {
    /** Produto/sistema esperado no plano (null = query genérica). */
    product: string | null;
    /** Tier de fonte esperado no plano. */
    source_tier: SourceTier;
    /** Confiança mínima que o planner deve definir. */
    min_confidence: number;
    /** Intent esperado (opcional — só asserta quando definido). */
    intent?: string;
    /** Slug do artigo KB primário esperado — metadata para RAGAS, não assert determinístico. */
    primary_kb: string;
    /** Artigos KB complementares aceitáveis. */
    secondary_kb?: string[];
    /** Categoria GLPI esperada. */
    category: string;
  };
  /**
   * Termos que NÃO devem aparecer no normalizedQuery após sanitização.
   * Usado para validar PII-stripping e domain isolation.
   */
  forbidden: string[];
}

// ── G0.6 base queries (17 — inherited from kbSearchPlanner.test.ts) ───────────

export const GOLDEN_SET_G06: readonly GoldenSetQuery[] = [
  {
    id: 'g06-01-micromed-nao-abre',
    query: 'meu micromed nao esta abrindo',
    expected: {
      product: 'Micromed',
      source_tier: 'tier_1_product_specific',
      min_confidence: 0.60,
      intent: 'application_not_opening',
      primary_kb: 'kb-micromed-nao-abre',
      category: 'Sistema / Micromed',
    },
    forbidden: ['slmgr', 'ativacao windows', 'licenca windows'],
  },
  {
    id: 'g06-02-ad-sync',
    query: 'active directory nao esta sincronizando usuarios',
    expected: {
      product: 'Active Directory',
      source_tier: 'tier_1_product_specific',
      min_confidence: 0.60,
      intent: 'identity_sync',
      primary_kb: 'kb-ad-sync-nao-funciona',
      category: 'Identidade / Active Directory',
    },
    forbidden: ['micromed', 'ativacao'],
  },
  {
    id: 'g06-03-synology-restore',
    query: 'restaurar arquivo synology active backup',
    expected: {
      product: 'Synology',
      source_tier: 'tier_1_product_specific',
      min_confidence: 0.60,
      intent: 'backup_restore',
      primary_kb: 'kb-synology-restore-active-backup',
      category: 'Backup / Synology',
    },
    forbidden: ['micromed', 'windows ativacao'],
  },
  {
    id: 'g06-04-backup-arquivo-em-uso',
    query: 'backup falhou arquivo em uso ontem a noite',
    expected: {
      product: 'Backup',
      source_tier: 'tier_2_operational_kb',
      min_confidence: 0.70,
      intent: 'backup_restore',
      primary_kb: 'kb-backup-arquivo-em-uso',
      category: 'Backup / Operacional',
    },
    forbidden: ['micromed', 'slmgr'],
  },
  {
    id: 'g06-05-windows-lento',
    query: 'windows atualizando devagar',
    expected: {
      product: null,
      source_tier: 'tier_3_generic_playbook',
      min_confidence: 0.25,
      primary_kb: 'kb-windows-performance-generic',
      category: 'Sistema / Windows',
    },
    forbidden: ['micromed'],
  },
  {
    id: 'g06-06-licenca-slmgr',
    query: 'windows precisa ativar licenca slmgr',
    expected: {
      product: null,
      source_tier: 'tier_1_product_specific',
      min_confidence: 0.60,
      intent: 'license_activation',
      primary_kb: 'kb-windows-ativacao-licenca',
      category: 'Sistema / Windows',
    },
    forbidden: ['micromed', 'synology'],
  },
  {
    id: 'g06-07-micromed-nao-abre-v2',
    query: 'micromed nao abre',
    expected: {
      product: 'Micromed',
      source_tier: 'tier_1_product_specific',
      min_confidence: 0.60,
      primary_kb: 'kb-micromed-nao-abre',
      category: 'Sistema / Micromed',
    },
    forbidden: ['sql_query', 'raw_sql', 'executable_command'],
  },
  {
    id: 'g06-08-very-generic',
    query: 'ok falhou',
    expected: {
      product: null,
      source_tier: 'tier_3_generic_playbook',
      min_confidence: 0.75,
      primary_kb: 'kb-triagem-generica',
      category: 'Suporte / Geral',
    },
    forbidden: [],
  },
  {
    id: 'g06-09-synology-restore-v2',
    query: 'backup synology restore arquivo',
    expected: {
      product: 'Synology',
      source_tier: 'tier_1_product_specific',
      min_confidence: 0.60,
      primary_kb: 'kb-synology-restore-active-backup',
      category: 'Backup / Synology',
    },
    forbidden: ['windows ativacao', 'micromed'],
  },
  {
    id: 'g06-10-azure-ad-connect',
    query: 'azure ad connect nao sincroniza usuarios',
    expected: {
      product: 'Active Directory',
      source_tier: 'tier_1_product_specific',
      min_confidence: 0.60,
      primary_kb: 'kb-ad-sync-nao-funciona',
      category: 'Identidade / Active Directory',
    },
    forbidden: ['ativacao windows', 'micromed'],
  },
  {
    id: 'g06-11-micromed-ctx',
    query: 'sistema nao abre',
    clientContext: { productOrSystem: 'Micromed' },
    expected: {
      product: 'Micromed',
      source_tier: 'tier_1_product_specific',
      min_confidence: 0.60,
      primary_kb: 'kb-micromed-nao-abre',
      category: 'Sistema / Micromed',
    },
    forbidden: [],
  },
  {
    id: 'g06-12-micromed-permissao',
    query: 'micromed permissao pasta',
    expected: {
      product: 'Micromed',
      source_tier: 'tier_1_product_specific',
      min_confidence: 0.60,
      primary_kb: 'kb-micromed-permissao-pasta',
      category: 'Sistema / Micromed',
    },
    forbidden: ['slmgr', 'ativacao'],
  },
  {
    id: 'g06-13-micromed-pii',
    query: 'micromed do usuario 41988334449 nao abre',
    expected: {
      product: 'Micromed',
      source_tier: 'tier_1_product_specific',
      min_confidence: 0.60,
      primary_kb: 'kb-micromed-nao-abre',
      category: 'Sistema / Micromed',
    },
    forbidden: ['41988334449'],  // phone must be stripped
  },
  {
    id: 'g06-14-backup-restaurar',
    query: 'preciso restaurar arquivo do backup de ontem',
    expected: {
      product: 'Backup',           // "backup" alias → Backup anchor
      source_tier: 'tier_2_operational_kb',
      min_confidence: 0.70,        // Backup anchor uses 0.70
      intent: 'backup_restore',
      primary_kb: 'kb-backup-arquivo-em-uso',
      category: 'Backup / Operacional',
    },
    forbidden: ['micromed', 'windows ativacao'],
  },
  {
    id: 'g06-15-firewall-micromed',
    query: 'firewall bloqueando api do micromed',
    expected: {
      product: 'Micromed',
      source_tier: 'tier_1_product_specific',
      min_confidence: 0.60,
      primary_kb: 'kb-micromed-conectividade-firewall',
      category: 'Sistema / Micromed',
    },
    forbidden: ['windows ativacao licenca'],
  },
  {
    id: 'g06-16-m365-licenca',
    query: 'usuario nao consegue acessar m365 licenca',
    expected: {
      product: 'Microsoft 365',
      source_tier: 'tier_1_product_specific',
      min_confidence: 0.60,
      primary_kb: 'kb-m365-licenca-usuario',
      category: 'Cloud / Microsoft 365',
    },
    forbidden: ['micromed', 'synology'],
  },
  {
    id: 'g06-17-proxy-api',
    query: 'proxy bloqueando requisicoes da api interna',
    expected: {
      product: 'Firewall / Proxy',
      source_tier: 'tier_2_operational_kb',
      min_confidence: 0.70,
      primary_kb: 'kb-proxy-bloqueio-api',
      category: 'Rede / Proxy',
    },
    forbidden: ['micromed', 'windows ativacao'],
  },
] as const;

// ── F2.1 expansion queries (33 — new coverage) ────────────────────────────────

export const GOLDEN_SET_EXPANSION: readonly GoldenSetQuery[] = [
  // ── Micromed adicional ───────────────────────────────────────────────────────
  {
    id: 'f21-01-micromed-update-crash',
    query: 'micromed fechou apos atualizacao automatica',
    expected: {
      product: 'Micromed',
      source_tier: 'tier_1_product_specific',
      min_confidence: 0.60,
      // intent omitido: "fechou" ≠ padrão "nao abre/inicia" — planner retorna 'generic'
      primary_kb: 'kb-micromed-nao-abre',
      secondary_kb: ['kb-micromed-permissao-pasta'],
      category: 'Sistema / Micromed',
    },
    forbidden: ['slmgr', 'active directory'],
  },
  {
    id: 'f21-02-micromed-login',
    query: 'usuario nao consegue fazer login no micromed',
    expected: {
      product: 'Micromed',
      source_tier: 'tier_1_product_specific',
      min_confidence: 0.60,
      primary_kb: 'kb-micromed-nao-abre',
      category: 'Sistema / Micromed',
    },
    forbidden: ['active directory', 'windows ativacao'],
  },
  {
    id: 'f21-03-micromed-lento',
    query: 'micromed carregando muito lento desde ontem',
    expected: {
      product: 'Micromed',
      source_tier: 'tier_1_product_specific',
      min_confidence: 0.60,
      primary_kb: 'kb-micromed-performance',
      secondary_kb: ['kb-micromed-nao-abre'],
      category: 'Sistema / Micromed',
    },
    forbidden: ['slmgr', 'windows ativacao'],
  },
  {
    id: 'f21-04-micromed-banco',
    query: 'micromed nao conecta banco de dados erro de conexao',
    expected: {
      product: 'Micromed',
      source_tier: 'tier_1_product_specific',
      min_confidence: 0.60,
      primary_kb: 'kb-micromed-conectividade-banco',
      secondary_kb: ['kb-micromed-nao-abre'],
      category: 'Sistema / Micromed',
    },
    forbidden: ['windows ativacao', 'synology'],
  },
  // ── Active Directory adicional ───────────────────────────────────────────────
  {
    id: 'f21-05-ad-bloqueado',
    query: 'usuario bloqueado no active directory nao consegue acessar',
    expected: {
      product: 'Active Directory',
      source_tier: 'tier_1_product_specific',
      min_confidence: 0.60,
      primary_kb: 'kb-ad-usuario-bloqueado',
      category: 'Identidade / Active Directory',
    },
    forbidden: ['ativacao windows', 'micromed', 'slmgr'],
  },
  {
    id: 'f21-06-ad-reset-senha',
    query: 'preciso resetar senha do usuario no active directory',
    expected: {
      product: 'Active Directory',
      source_tier: 'tier_1_product_specific',
      min_confidence: 0.60,
      primary_kb: 'kb-ad-reset-senha',
      category: 'Identidade / Active Directory',
    },
    forbidden: ['ativacao', 'micromed'],
  },
  {
    id: 'f21-07-entra-mfa',
    query: 'entra id mfa nao funcionando usuario sem acesso',
    expected: {
      product: 'Active Directory',
      source_tier: 'tier_1_product_specific',
      min_confidence: 0.60,
      primary_kb: 'kb-ad-mfa-problema',
      category: 'Identidade / Active Directory',
    },
    forbidden: ['micromed', 'synology', 'ativacao'],
  },
  // ── Microsoft 365 adicional ──────────────────────────────────────────────────
  {
    id: 'f21-08-m365-outlook-sync',
    query: 'outlook nao sincroniza emails microsoft 365',
    expected: {
      product: 'Microsoft 365',
      source_tier: 'tier_1_product_specific',
      min_confidence: 0.60,
      primary_kb: 'kb-m365-outlook-sincronizacao',
      category: 'Cloud / Microsoft 365',
    },
    forbidden: ['micromed', 'synology', 'active directory'],
  },
  {
    id: 'f21-09-teams-nao-abre',
    query: 'microsoft teams nao inicia na maquina do usuario',
    expected: {
      product: null,               // 'microsoft teams' não é alias do M365 anchor
      source_tier: 'tier_1_product_specific', // generic plan inclui tier_1 em sourceTiersAllowed
      min_confidence: 0.60,
      primary_kb: 'kb-m365-teams-nao-abre',
      category: 'Cloud / Microsoft 365',
    },
    forbidden: ['micromed', 'synology'],
  },
  {
    id: 'f21-10-sharepoint-acesso',
    query: 'usuario nao acessa arquivos sharepoint office 365',
    expected: {
      product: 'Microsoft 365',
      source_tier: 'tier_1_product_specific',
      min_confidence: 0.60,
      primary_kb: 'kb-m365-sharepoint-permissao',
      category: 'Cloud / Microsoft 365',
    },
    forbidden: ['micromed', 'synology', 'backup'],
  },
  // ── Synology adicional ───────────────────────────────────────────────────────
  {
    id: 'f21-11-synology-smb',
    query: 'nao consigo acessar pasta compartilhada no synology smb',
    expected: {
      product: 'Synology',
      source_tier: 'tier_1_product_specific',
      min_confidence: 0.60,
      primary_kb: 'kb-synology-smb-acesso',
      category: 'Armazenamento / Synology',
    },
    forbidden: ['windows ativacao', 'micromed'],
  },
  {
    id: 'f21-12-synology-offline',
    query: 'diskstation synology offline sem resposta',
    expected: {
      product: 'Synology',
      source_tier: 'tier_1_product_specific',
      min_confidence: 0.60,
      primary_kb: 'kb-synology-disponibilidade',
      category: 'Armazenamento / Synology',
    },
    forbidden: ['windows ativacao', 'active directory'],
  },
  // ── Veeam backup ─────────────────────────────────────────────────────────────
  {
    id: 'f21-13-veeam-job-falhou',
    query: 'veeam backup job falhou erro de rede noite',
    expected: {
      product: 'Backup',           // "backup" alias → Backup anchor (não há anchor para Veeam)
      source_tier: 'tier_2_operational_kb', // Backup anchor é tier_2
      min_confidence: 0.70,        // Backup anchor usa 0.70
      intent: 'backup_restore',
      primary_kb: 'kb-veeam-backup-falha',
      category: 'Backup / Veeam',
    },
    forbidden: ['windows ativacao', 'micromed', 'active directory sync'],
  },
  {
    id: 'f21-14-veeam-autenticacao',
    query: 'veeam nao autentica no servidor vmware',
    expected: {
      product: null,               // sem anchor para Veeam — plano genérico
      source_tier: 'tier_1_product_specific', // generic plan inclui tier_1
      min_confidence: 0.60,
      primary_kb: 'kb-veeam-autenticacao-vmware',
      category: 'Backup / Veeam',
    },
    forbidden: ['windows ativacao licenca', 'micromed'],
  },
  {
    id: 'f21-15-backup-incremental',
    query: 'backup incremental nao completando ontem e hoje',
    expected: {
      product: 'Backup',
      source_tier: 'tier_2_operational_kb',
      min_confidence: 0.70,
      intent: 'backup_restore',
      primary_kb: 'kb-backup-incremental-falha',
      category: 'Backup / Operacional',
    },
    forbidden: ['micromed', 'windows ativacao'],
  },
  // ── Rede / Firewall / Proxy ──────────────────────────────────────────────────
  {
    id: 'f21-16-vpn-sem-conexao',
    query: 'vpn nao conecta usuario em home office',
    expected: {
      product: null,
      source_tier: 'tier_2_operational_kb',
      min_confidence: 0.60,
      primary_kb: 'kb-vpn-sem-conexao',
      category: 'Rede / VPN',
    },
    forbidden: ['micromed', 'windows ativacao licenca'],
  },
  {
    id: 'f21-17-dns-interno',
    query: 'dns nao resolve dominio interno da empresa',
    expected: {
      product: null,
      source_tier: 'tier_2_operational_kb',
      min_confidence: 0.60,
      primary_kb: 'kb-dns-resolucao-interna',
      category: 'Rede / DNS',
    },
    forbidden: ['micromed', 'windows ativacao'],
  },
  {
    id: 'f21-18-ssl-expirado',
    query: 'certificado ssl expirado no servidor web interno',
    expected: {
      product: null,
      source_tier: 'tier_2_operational_kb',
      min_confidence: 0.60,
      primary_kb: 'kb-ssl-certificado-expiracao',
      category: 'Segurança / Certificados',
    },
    forbidden: ['micromed', 'windows ativacao'],
  },
  // ── Servidor / Infraestrutura ─────────────────────────────────────────────────
  {
    id: 'f21-19-servidor-ping',
    query: 'servidor de arquivos nao responde ao ping',
    expected: {
      product: null,
      source_tier: 'tier_2_operational_kb',
      min_confidence: 0.60,
      primary_kb: 'kb-servidor-disponibilidade',
      category: 'Infraestrutura / Servidor',
    },
    forbidden: ['micromed', 'windows ativacao'],
  },
  {
    id: 'f21-20-exchange-email',
    query: 'exchange nao entrega emails externos usuarios reclamando',
    expected: {
      product: null,
      source_tier: 'tier_2_operational_kb',
      min_confidence: 0.60,
      primary_kb: 'kb-exchange-entrega-email',
      category: 'Email / Exchange',
    },
    forbidden: ['micromed', 'windows ativacao licenca'],
  },
  {
    id: 'f21-21-disco-cheio',
    query: 'storage sem espaco em disco servidor travando',
    expected: {
      product: null,
      source_tier: 'tier_2_operational_kb',
      min_confidence: 0.60,
      primary_kb: 'kb-storage-espaco-disco',
      category: 'Infraestrutura / Storage',
    },
    forbidden: ['micromed', 'windows ativacao'],
  },
  // ── Windows genérico ─────────────────────────────────────────────────────────
  {
    id: 'f21-22-pc-lento',
    query: 'computador iniciando muito lento manha',
    expected: {
      product: null,
      source_tier: 'tier_3_generic_playbook',
      min_confidence: 0.25,
      primary_kb: 'kb-pc-performance-generica',
      category: 'Suporte / Windows',
    },
    forbidden: ['micromed', 'active directory', 'synology'],
  },
  {
    id: 'f21-23-impressora',
    query: 'impressora nao imprime documentos windows',
    expected: {
      product: null,
      source_tier: 'tier_3_generic_playbook',
      min_confidence: 0.25,
      primary_kb: 'kb-impressora-configuracao',
      category: 'Suporte / Periféricos',
    },
    forbidden: ['micromed', 'active directory'],
  },
  // ── Queries muito genéricas (elevated confidence threshold) ──────────────────
  {
    id: 'f21-24-generic-erro',
    query: 'erro sistema',
    expected: {
      product: null,
      source_tier: 'tier_3_generic_playbook',
      min_confidence: 0.75,
      primary_kb: 'kb-triagem-generica',
      category: 'Suporte / Geral',
    },
    forbidden: [],
  },
  {
    id: 'f21-25-generic-nao-funciona',
    query: 'nao funciona',
    expected: {
      product: null,
      source_tier: 'tier_3_generic_playbook',
      min_confidence: 0.75,
      primary_kb: 'kb-triagem-generica',
      category: 'Suporte / Geral',
    },
    forbidden: [],
  },
  // ── PII stripping adicional ───────────────────────────────────────────────────
  {
    id: 'f21-26-pii-nome-completo',
    query: 'joao silva micromed nao abre',
    expected: {
      product: 'Micromed',
      source_tier: 'tier_1_product_specific',
      min_confidence: 0.60,
      primary_kb: 'kb-micromed-nao-abre',
      category: 'Sistema / Micromed',
    },
    forbidden: [],  // name handling is service-layer, not planner
  },
  // ── Queries contextuais (clientContext hint) ──────────────────────────────────
  {
    id: 'f21-27-ctx-veeam',
    query: 'job falhou ontem a noite com erro',
    clientContext: { productOrSystem: 'Veeam' },
    expected: {
      product: 'Veeam',
      source_tier: 'tier_1_product_specific',
      min_confidence: 0.60,
      primary_kb: 'kb-veeam-backup-falha',
      category: 'Backup / Veeam',
    },
    forbidden: ['micromed', 'windows ativacao'],
  },
  {
    id: 'f21-28-ctx-synology',
    query: 'nao consigo acessar',
    clientContext: { productOrSystem: 'Synology' },
    expected: {
      product: 'Synology',
      source_tier: 'tier_1_product_specific',
      min_confidence: 0.60,
      primary_kb: 'kb-synology-smb-acesso',
      category: 'Armazenamento / Synology',
    },
    forbidden: ['micromed'],
  },
  // ── Fortinet / Sophos (tier_1 security) ──────────────────────────────────────
  {
    id: 'f21-29-fortinet',
    query: 'fortinet vpn ssl nao conecta usuario externo',
    expected: {
      product: null,               // sem anchor para Fortinet — plano genérico
      source_tier: 'tier_1_product_specific', // generic plan inclui tier_1
      min_confidence: 0.60,
      primary_kb: 'kb-fortinet-vpn-ssl',
      category: 'Segurança / Fortinet',
    },
    forbidden: ['micromed', 'windows ativacao'],
  },
  {
    id: 'f21-30-sophos-bloqueio',
    query: 'sophos endpoint bloqueando aplicativo da empresa',
    expected: {
      product: null,               // sem anchor para Sophos — plano genérico
      source_tier: 'tier_1_product_specific', // generic plan inclui tier_1
      min_confidence: 0.60,
      primary_kb: 'kb-sophos-whitelist-aplicativo',
      category: 'Segurança / Sophos',
    },
    forbidden: ['micromed', 'windows ativacao'],
  },
  // ── Zabbix ──────────────────────────────────────────────────────────────────
  {
    id: 'f21-31-zabbix-alerta',
    query: 'zabbix disparando alertas falsos servidores',
    expected: {
      product: null,               // sem anchor para Zabbix — plano genérico
      source_tier: 'tier_1_product_specific', // generic plan inclui tier_1
      min_confidence: 0.60,
      primary_kb: 'kb-zabbix-alerta-falso',
      category: 'Monitoramento / Zabbix',
    },
    forbidden: ['micromed', 'windows ativacao'],
  },
  // ── Acesso / permissão genérico ──────────────────────────────────────────────
  {
    id: 'f21-32-acesso-negado-pasta',
    query: 'acesso negado a pasta compartilhada na rede',
    expected: {
      product: null,
      source_tier: 'tier_2_operational_kb',
      min_confidence: 0.60,
      primary_kb: 'kb-permissao-pasta-compartilhada',
      category: 'Rede / Compartilhamento',
    },
    forbidden: ['micromed', 'windows ativacao licenca'],
  },
  {
    id: 'f21-33-email-corporativo',
    query: 'email corporativo nao entrega mensagens enviadas',
    expected: {
      product: null,
      source_tier: 'tier_2_operational_kb',
      min_confidence: 0.60,
      primary_kb: 'kb-email-entrega-problema',
      category: 'Email / Operacional',
    },
    forbidden: ['micromed', 'windows ativacao'],
  },
] as const;

// ── Full golden set (G0.6 + expansion = 50 queries) ──────────────────────────

export const GOLDEN_SET: readonly GoldenSetQuery[] =
  [...GOLDEN_SET_G06, ...GOLDEN_SET_EXPANSION];

export const GOLDEN_SET_META = {
  version: '1.0.0',
  phase: 'integaglpi_v9_kb_quality_001',
  deliverable: 'F2.1',
  total_queries: GOLDEN_SET.length,
  g06_queries: GOLDEN_SET_G06.length,
  expansion_queries: GOLDEN_SET_EXPANSION.length,
} as const;
