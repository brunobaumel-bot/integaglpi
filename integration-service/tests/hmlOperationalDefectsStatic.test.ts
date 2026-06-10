/**
 * HML Operational Defects Fix — static assertions (D01–D11)
 *
 * Phase: integaglpi_v9_hml_operational_defects_fix_001
 *
 * Cada defeito da validação visual HML tem asserções estáticas próprias:
 *   D01  Hub sem template cru ({{/* ... *\/}})
 *   D02  Migration idempotente source_tier (KB Quality card)
 *   D03  Botão "Sincronizar agora" no field mapping (CSRF + permissão no serviço)
 *   D04  Menu LogMeIn persistente (LogmeinGroupMenu em todos os fronts)
 *   D05  Busca de hosts por entidade (AJAX entity_id + SQL group_maps)
 *   D06  Alvos escolhidos na criação da regra (target_hosts[])
 *   D07  Dropdowns reais de fila/grupo e categoria ITIL
 *   D08  Permissão de escrita com fallback Config>UPDATE
 *   D09  Diagnóstico acionável na conciliação vazia
 *   D10  secret_decrypt_failed com orientação de regravação (sem expor segredo)
 *   D11  Multi-problema: split determinístico, KB por problema, KB_INSUFFICIENT
 */

import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p: string): Promise<string> => readFile(resolve(repoRoot, p), 'utf8');

// ── D01 ───────────────────────────────────────────────────────────────────────

describe('D01 — Hub Operacional sem template cru', () => {
  it('central_hub_dashboard.php não contém {{/* nem */}}', async () => {
    const tpl = await read('integaglpi/templates/central_hub_dashboard.php');
    expect(tpl).not.toContain('{{/*');
    expect(tpl).not.toContain('*/}}');
    expect(tpl).not.toContain('{{');
  });

  it('template preserva os 5 cards e o badge read-only', async () => {
    const tpl = await read('integaglpi/templates/central_hub_dashboard.php');
    for (const label of ['Saúde HML', 'Smart Help', 'KB Quality', 'LogMeIn', 'Alarmes']) {
      expect(tpl).toContain(label);
    }
    expect(tpl).toContain('read-only');
  });
});

// ── D02 ───────────────────────────────────────────────────────────────────────

describe('D02 — KB Quality sem erro source_tier', () => {
  it('migration 051 é idempotente, aditiva e em tabela própria da integração', async () => {
    const sql = await read('integration-service/schema-migrations/051_kb_candidates_add_source_tier.sql');
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS source_tier');
    expect(sql).toContain('glpi_plugin_integaglpi_kb_candidates');
    expect(sql).not.toMatch(/\bDROP\b|\bTRUNCATE\b|\bDELETE\s+FROM\b/i);
    expect(sql).not.toMatch(/glpi_tickets|glpi_users|glpi_computers/);
  });

  it('KbEffectivenessService mantém COALESCE como fallback de leitura', async () => {
    const svc = await read('integration-service/src/services/KbEffectivenessService.ts');
    expect(svc).toContain("COALESCE(c.source_tier, 'tier_3_generic_playbook')");
  });
});

// ── D03 ───────────────────────────────────────────────────────────────────────

describe('D03 — Sincronizar agora no Mapeamento de Campos', () => {
  it('front trata action sync_now reutilizando syncReadonlyCatalog (permissão+auditoria no serviço)', async () => {
    const front = await read('integaglpi/front/logmein.fieldmapping.php');
    expect(front).toContain("$action === 'sync_now'");
    expect(front).toContain('syncReadonlyCatalog($userId)');
    // CSRF validado antes de qualquer action.
    expect(front).toContain('Plugin::isCsrfValid($_POST)');
  });

  it('template tem o botão com CSRF e confirmação read-only', async () => {
    const tpl = await read('integaglpi/templates/logmein_fieldmapping.php');
    expect(tpl).toContain('name="action" value="sync_now"');
    expect(tpl).toContain('Sincronizar agora');
    expect(tpl).toContain('renderCsrfToken()');
    expect(tpl).toContain('nenhum ativo GLPI é alterado');
  });

  it('serviço de sync exige RIGHT_MANAGE_LOGMEIN_MAPPING e audita negação', async () => {
    const svc = await read('integaglpi/src/Service/LogmeinGovernanceService.php');
    expect(svc).toContain('RIGHT_MANAGE_LOGMEIN_MAPPING');
    expect(svc).toContain('logAccessDenied');
  });
});

// ── D04 ───────────────────────────────────────────────────────────────────────

describe('D04 — Menu LogMeIn Central persistente', () => {
  const fronts = [
    'integaglpi/front/logmein.mapping.php',
    'integaglpi/front/logmein.fieldmapping.php',
    'integaglpi/front/logmein.alarm.php',
    'integaglpi/front/logmein.reconciliation.php',
    'integaglpi/front/logmein.reports.php',
  ];

  for (const front of fronts) {
    it(`${front} usa LogmeinGroupMenu como pai no Html::header`, async () => {
      const src = await read(front);
      expect(src).toContain('LogmeinGroupMenu');
      expect(src).not.toMatch(/Html::header\([^;]*GestaoGroupMenu::class/s);
    });
  }
});

// ── D05 ───────────────────────────────────────────────────────────────────────

describe('D05 — Alarmes: equipamentos por entidade', () => {
  it('searchHosts aceita entityId e filtra por candidato direto OU grupo mapeado', async () => {
    const svc = await read('integaglpi/src/Service/LogmeinAlarmAdminService.php');
    expect(svc).toContain('int $entityId = 0');
    expect(svc).toContain('glpi_entity_candidate_id = :eid');
    expect(svc).toContain('glpi_plugin_integaglpi_logmein_group_maps');
    expect(svc).toContain('is_active = TRUE');
  });

  it('AJAX search_hosts encaminha entity_id', async () => {
    const front = await read('integaglpi/front/logmein.alarm.php');
    expect(front).toContain("(int) ($_GET['entity_id'] ?? 0)");
    expect(front).toContain('searchHosts($q, $groupId, 100, $entityId)');
  });

  it('UI de criação busca por entidade selecionada na seção ①', async () => {
    const tpl = await read('integaglpi/templates/logmein_alarm.php');
    expect(tpl).toContain('createEntitySelect');
    expect(tpl).toContain("'&entity_id=' + encodeURIComponent(eid)");
  });
});

// ── D06 ───────────────────────────────────────────────────────────────────────

describe('D06 — Alarmes: alvos na criação (entidade/grupo/avulso)', () => {
  it('create_rule processa target_hosts[] e adiciona alvos após criar', async () => {
    const front = await read('integaglpi/front/logmein.alarm.php');
    expect(front).toContain("$_POST['target_hosts']");
    expect(front).toContain("explode('||'");
    expect(front).toContain('addTarget((string) $result[\'rule_id\']');
    expect(front).toContain('alvo(s) adicionado(s)');
  });

  it('template oferece os 3 modos: entidade, grupo LogMeIn e avulso/global', async () => {
    const tpl = await read('integaglpi/templates/logmein_alarm.php');
    expect(tpl).toContain("lmCreateTargetMode('entity')");
    expect(tpl).toContain("lmCreateTargetMode('group')");
    expect(tpl).toContain("lmCreateTargetMode('global')");
    expect(tpl).toContain('target_hosts[]');
  });
});

// ── D07 ───────────────────────────────────────────────────────────────────────

describe('D07 — Dropdowns reais de fila/grupo e categoria', () => {
  it('serviço lê glpi_groups (is_assign=1) e glpi_itilcategories via $DB', async () => {
    const svc = await read('integaglpi/src/Service/LogmeinAlarmAdminService.php');
    expect(svc).toContain('function listItilGroups');
    expect(svc).toContain('function listItilCategories');
    expect(svc).toContain("'is_assign' => 1");
    expect(svc).toContain("'glpi_itilcategories'");
  });

  it('template renderiza selects quando há dados (fallback numérico só sem dados)', async () => {
    const tpl = await read('integaglpi/templates/logmein_alarm.php');
    expect(tpl).toContain('select name="glpi_group_id"');
    expect(tpl).toContain('select name="glpi_itil_category_id"');
    expect(tpl).toContain('selecionar fila/grupo');
    expect(tpl).toContain('selecionar categoria');
  });

  it('front carrega itilGroups/itilCategories para o template', async () => {
    const front = await read('integaglpi/front/logmein.alarm.php');
    expect(front).toContain('listItilGroups()');
    expect(front).toContain('listItilCategories()');
  });
});

// ── D08 ───────────────────────────────────────────────────────────────────────

describe('D08 — Permissão de escrita em Alarmes', () => {
  it('canWrite tem fallback Config>UPDATE e mensagem explicativa; bloqueio preservado', async () => {
    const front = await read('integaglpi/front/logmein.alarm.php');
    expect(front).toContain("Session::haveRight('config', UPDATE)");
    expect(front).toContain('requer direito de atualização do plugin');
    // O gate continua existindo para quem não tem nenhum dos direitos.
    expect(front).toContain('if (!$canWrite)');
  });
});

// ── D09 ───────────────────────────────────────────────────────────────────────

describe('D09 — Conciliação de Acessos com diagnóstico acionável', () => {
  it('front consulta total sem filtros e monta checks de fonte/filtros', async () => {
    const front = await read('integaglpi/front/logmein.reconciliation.php');
    expect(front).toContain('$reconDiagnostics');
    expect(front).toContain('queue?limit=1&page=1');
    expect(front).toContain('Total de itens no ledger (sem filtros)');
    expect(front).toContain('filtros de status/entidade atuais estão escondendo');
    expect(front).toContain('LOGMEIN_INTEGRATION_ENABLED');
  });

  it('template renderiza o painel de diagnóstico quando a fila está vazia', async () => {
    const tpl = await read('integaglpi/templates/logmein_reconciliation.php');
    expect(tpl).toContain('Diagnóstico da conciliação');
    expect(tpl).toContain("reconDiagnostics['checks']");
  });

  it('diagnóstico não expõe credenciais/token', async () => {
    const front = await read('integaglpi/front/logmein.reconciliation.php');
    // O bloco de diagnóstico nunca imprime o apiKey.
    const diagBlock = front.slice(front.indexOf('$reconDiagnostics'));
    expect(diagBlock).not.toMatch(/echo[^;]*apiKey|print[^;]*apiKey/);
  });
});

// ── D10 ───────────────────────────────────────────────────────────────────────

describe('D10 — Pesquisa Externa: secret_decrypt_failed acionável', () => {
  it('AiSecretVaultService converte falha de decrypt em AiCloudProviderException tipada', async () => {
    const vault = await read('integaglpi/src/Service/AiSecretVaultService.php');
    expect(vault).toContain("'secret_decrypt_failed',");
    expect(vault).toContain('catch (RuntimeException $decryptError)');
    // Nunca loga/retorna o segredo ou a cifra.
    expect(vault).not.toMatch(/error_log\([^)]*\$secret\b/);
    expect(vault).not.toMatch(/error_log\([^)]*encrypted_secret/);
  });

  it('ExternalResearchService orienta regravação sem expor valor', async () => {
    const svc = await read('integaglpi/src/Service/ExternalResearchService.php');
    expect(svc).toContain('friendlyCloudErrorLabel');
    expect(svc).toContain('chave mestra do Secret Vault provavelmente mudou');
    expect(svc).toContain('Regrave o segredo');
    expect(svc).toContain('INTEGAGLPI_AI_VAULT_MASTER_KEY ausente');
    // A mensagem de falha continua confirmando que nada bruto foi enviado.
    expect(svc).toContain('Nenhum dado bruto foi enviado ou salvo');
  });
});

// ── D11 ───────────────────────────────────────────────────────────────────────

describe('D11 — Smart Help multi-problema', () => {
  it('splitDistinctProblems existe e é determinístico (sem IA no caminho)', async () => {
    const svc = await read('integaglpi/src/Service/SmartHelpService.php');
    expect(svc).toContain('function splitDistinctProblems');
    expect(svc).toContain('function inferProblemTopic');
    expect(svc).toContain('function multiProblemSummary');
    // O split não chama IA.
    const splitBlock = svc.slice(
      svc.indexOf('function splitDistinctProblems'),
      svc.indexOf('function inferProblemTopic'),
    );
    expect(splitBlock).not.toContain('technicalSummaryAi');
    expect(splitBlock).not.toContain('postJson');
  });

  it('tópicos cobrem o caso real Micromed + internet', async () => {
    const svc = await read('integaglpi/src/Service/SmartHelpService.php');
    expect(svc).toMatch(/'micromed'\s*=>/);
    expect(svc).toMatch(/'rede'\s*=>.*internet/);
    expect(svc).toContain('nenhum site');
  });

  it('resumo multi-problema separa blocos e não inventa evidência', async () => {
    const svc = await read('integaglpi/src/Service/SmartHelpService.php');
    expect(svc).toContain('Problemas relatados: ');
    expect(svc).toContain('tratar separadamente');
    // Evidência só quando explícita; senão "Não informada" (inferEvidenceFromText).
    expect(svc).toContain("return 'Não informada';");
    // Placeholders viraram perguntas claras em "Faltam", não conteúdo.
    expect(svc).toContain('mensagem de erro exata?');
  });

  it('KB é buscada por problema e problemas sem cobertura viram KB_INSUFFICIENT', async () => {
    const svc = await read('integaglpi/src/Service/SmartHelpService.php');
    expect(svc).toContain('function extractProblemsForSearch');
    expect(svc).toContain("'KB_INSUFFICIENT'");
    expect(svc).toContain("'KB_FOUND'");
    expect(svc).toContain("'problem_index'");
    expect(svc).toContain('kbCoverage');
    expect(svc).toContain('KB_INSUFFICIENT para ');
  });

  it('planner injeta boost terms por intenção (Micromed não abre → startup)', async () => {
    const planner = await read('integration-service/src/domain/services/KbSearchPlannerService.ts');
    expect(planner).toContain('INTENT_BOOST_TERMS');
    expect(planner).toContain("application_not_opening: ['inicializar', 'startup'");
    expect(planner).toContain('INTENT_BOOST_TERMS[intent]');
  });
});

// ── Invariantes de segurança transversais ─────────────────────────────────────

describe('F-HML-FIX — invariantes de segurança', () => {
  it('nenhum arquivo alterado envia WhatsApp ou cria ticket automaticamente', async () => {
    const files = [
      'integaglpi/front/logmein.alarm.php',
      'integaglpi/front/logmein.fieldmapping.php',
      'integaglpi/front/logmein.reconciliation.php',
      'integaglpi/src/Service/LogmeinAlarmAdminService.php',
      'integaglpi/src/Service/SmartHelpService.php',
    ];
    for (const f of files) {
      const src = await read(f);
      expect(src, f).not.toMatch(/sendWhatsApp|sendOutbound|->add\(\s*new\s+Ticket/i);
    }
  });

  it('mudanças Node não acessam MariaDB nem iniciam sessão LogMeIn', async () => {
    const planner = await read('integration-service/src/domain/services/KbSearchPlannerService.ts');
    // Imports/uso real — comentários de contrato ("NO MariaDB access") são permitidos.
    expect(planner).not.toMatch(/from\s+['"]mysql|require\(['"]mysql|createConnection|mysqli/i);
    expect(planner).not.toMatch(/startSession|logmein.*session.*start/i);
  });
});
