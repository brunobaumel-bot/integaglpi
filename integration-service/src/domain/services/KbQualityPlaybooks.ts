/**
 * Playbooks operacionais — passos acionáveis para técnicos (não templates genéricos).
 * Ancorados em evidências históricas sanitizadas do projeto.
 */

import type { AgentCandidateRecord } from './AgentKbEnricher.js';

export type KbScenario =
  | 'vpn_connect_fail'
  | 'vpn_password'
  | 'vpn_resource_access'
  | 'office_activation'
  | 'outlook_issue'
  | 'network_share'
  | 'printer'
  | 'micromed'
  | 'backup_restore'
  | 'windows_server'
  | 'critical_incident'
  | 'reopen_ticket'
  | 'csat_satisfaction'
  | 'ad_sync'
  | 'internet_connectivity'
  | 'generic_it';

export interface QualityPlaybook {
  scenario: KbScenario;
  titleSuffix: string;
  context: string;
  symptoms: string[];
  likelyCauses: string[];
  resolutionSteps: string[];
  validationSteps: string[];
  commandsOrChecks: string[];
  triageQuestions: string[];
  incidentTree: string[];
  rollbackOrSafeExit: string[];
  escalationWhen: string[];
  prevention: string[];
  knownFalsePositives: string[];
}

function textBlob(r: AgentCandidateRecord): string {
  const n = (v: unknown) => (typeof v === 'string' ? v : '');
  const arr = (v: unknown) => (Array.isArray(v) ? v.join(' ') : '');
  return [
    n(r.title),
    n(r.category ?? r.categorySuggestion),
    n(r.problem_pattern ?? r.problemPattern),
    n(r.probable_cause ?? r.probableCause),
    n(r.evidence ?? r.evidenceSummarySanitized),
    arr(r.symptoms ?? r.symptomsJson),
    arr(r.tags ?? r.tagsJson),
  ]
    .join(' ')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

export function detectKbScenario(r: AgentCandidateRecord): KbScenario {
  const t = textBlob(r);
  if (t.includes('micromed')) return 'micromed';
  if (
    t.includes('vpn')
    || t.includes('forticlient')
    || t.includes('openvpn')
    || t.includes('wireguard')
    || (t.includes('acesso remoto') && !t.includes('compartilh'))
  ) {
    if (t.includes('senha') || t.includes('password') || t.includes('esqueci')) return 'vpn_password';
    if (t.includes('diretorio') || t.includes('compartilh') || t.includes('servidor de arquivos')) {
      return 'vpn_resource_access';
    }
    return 'vpn_connect_fail';
  }
  if (t.includes('synology') || (t.includes('hyper backup') && t.includes('restaur'))) return 'backup_restore';
  if (t.includes('backup') || t.includes('veeam') || t.includes('restauracao') || t.includes('restore')) {
    return 'backup_restore';
  }
  if (
    t.includes('active directory')
    || t.includes('azure ad')
    || t.includes('ad connect')
    || t.includes('sincronizacao hibr')
  ) {
    return 'ad_sync';
  }
  if (t.includes('pfsense') || (t.includes('firewall') && t.includes('internet')) || t.includes('link caiu')) {
    return 'internet_connectivity';
  }
  if (t.includes('outlook') || (t.includes('office') && t.includes('email'))) return 'outlook_issue';
  if (
    (t.includes('office') || t.includes('m365') || t.includes('microsoft 365') || t.includes('ativ'))
    && !t.includes('synology')
  ) {
    return 'office_activation';
  }
  if (t.includes('impressora') || t.includes('print')) return 'printer';
  if (t.includes('compartilh') || t.includes('servidor de arquivos') || t.includes('acesso negado')) {
    return 'network_share';
  }
  if (t.includes('playbook') || t.includes('incidente critico') || t.includes('incidentes criticos') || t.includes('indisponivel')) {
    return 'critical_incident';
  }
  if (t.includes('reabertura') || t.includes('reopen')) return 'reopen_ticket';
  if (t.includes('satisfacao') || t.includes('csat')) return 'csat_satisfaction';
  if (t.includes('windows server') || t.includes('servidor > windows')) return 'windows_server';
  return 'generic_it';
}

const PLAYBOOKS: Record<KbScenario, QualityPlaybook> = {
  vpn_connect_fail: {
    scenario: 'vpn_connect_fail',
    titleSuffix: 'Falha ao conectar VPN',
    context:
      'Usuário não consegue estabelecer túnel VPN. Foco: diferenciar falha local (cliente/rede/credencial) '
      + 'de falha no concentrador ou política corporativa.',
    symptoms: [
      'Cliente VPN não conecta ou fica em "conectando"',
      'Mensagem de timeout, certificado inválido ou conexão recusada',
      'VPN conecta mas queda imediata',
      'Funciona em uma rede (4G) e falha em outra (Wi‑Fi corporativo)',
    ],
    likelyCauses: [
      'Credencial expirada ou senha alterada no AD sem atualizar VPN',
      'Perfil VPN desatualizado (host/porta/certificado)',
      'Firewall ou antivírus bloqueando cliente VPN',
      'Concentrador VPN indisponível ou limite de sessões',
      'Conflito de rota/DNS após conexão',
    ],
    triageQuestions: [
      'Qual cliente VPN (FortiClient, OpenVPN, outro) e versão?',
      'Mensagem de erro exata na tela (print)?',
      'Funciona fora da rede do cliente (hotspot 4G)?',
      'Outros usuários do mesmo cliente estão afetados?',
      'Houve troca de senha AD recente?',
    ],
    commandsOrChecks: [
      'Testar internet sem VPN (navegação/ping 8.8.8.8)',
      'Comparar conexão em rede alternativa (4G vs Wi‑Fi)',
      'Verificar validade do certificado no perfil VPN (consultivo)',
      'Conferir se o serviço do cliente VPN está em execução',
      'Validar horário/sincronização do relógio do SO (certificados)',
    ],
    resolutionSteps: [
      '1. Coletar print do erro e confirmar se o problema é só VPN ou também internet local',
      '2. Pedir teste em rede alternativa (4G) para isolar rede local vs VPN',
      '3. Verificar credencial: se senha AD foi alterada, atualizar senha no cliente VPN',
      '4. Remover e reimportar perfil VPN (exportar config padrão aprovada pelo time de infra)',
      '5. Reiniciar serviço/cliente VPN e testar novamente',
      '6. Desabilitar temporariamente firewall/AV de teste (com autorização) — se conectar, ajustar exceção',
      '7. Se múltiplos usuários afetados: escalar para infra verificar concentrador, certificados e licenças',
      '8. Após conectar: testar acesso a recurso interno esperado (share/RDP/app)',
    ],
    validationSteps: [
      'VPN conecta e mantém sessão por ≥5 min',
      'Usuário acessa recurso interno previsto (share, RDP ou app)',
      'Rotas/DNS internos funcionam (nslookup/ping a host interno — consultivo)',
      'Registrar causa raiz e perfil/credencial corrigidos no ticket',
    ],
    incidentTree: [
      'Só 1 usuário → credencial, perfil local, AV/firewall',
      'Vários usuários mesmo cliente → concentrador, certificado, política',
      'Conecta mas sem recurso → rota, DNS, ACL ou recurso de destino',
    ],
    rollbackOrSafeExit: [
      'Restaurar perfil VPN anterior se novo perfil piorou cenário',
      'Reativar firewall/AV se foi desabilitado para teste',
    ],
    escalationWhen: [
      'Falha em massa (>3 usuários simultâneos)',
      'Concentrador/certificado sob responsabilidade de infra',
      'Necessidade de alteração em firewall corporativo',
    ],
    prevention: [
      'Documentar perfil VPN padrão e procedimento de reset de senha',
      'Alertas de expiração de certificados VPN',
    ],
    knownFalsePositives: [
      'Recurso interno fora do ar — VPN ok mas aplicação/share indisponível',
      'Usuário tenta VPN dentro de rede que já bloqueia túnel',
    ],
  },

  vpn_password: {
    scenario: 'vpn_password',
    titleSuffix: 'Reset de senha VPN / AD',
    context: 'Usuário esqueceu senha ou credencial VPN rejeitada após troca de senha AD.',
    symptoms: [
      'Autenticação VPN falha com credencial inválida',
      'Usuário não lembra senha VPN/AD',
      'Senha AD alterada e VPN parou de funcionar',
    ],
    likelyCauses: [
      'Senha AD expirada ou reset pendente de sincronização',
      'Cliente VPN com senha salva desatualizada',
      'Conta bloqueada por tentativas inválidas',
    ],
    triageQuestions: [
      'A senha funciona no Windows/Outlook (login de domínio)?',
      'Quantas tentativas falhas já ocorreram?',
      'Reset de senha foi feito recentemente por quem?',
    ],
    commandsOrChecks: [
      'Verificar status da conta no AD (bloqueada/expirada — consultivo)',
      'Confirmar política de senha VPN = senha AD',
    ],
    resolutionSteps: [
      '1. Confirmar identidade do solicitante conforme política da empresa',
      '2. Verificar se conta AD está bloqueada — desbloquear se aplicável',
      '3. Orientar reset de senha AD pelo canal aprovado (não inventar senha por WhatsApp)',
      '4. Após reset: usuário atualiza senha no Windows e depois no cliente VPN',
      '5. Limpar credencial salva no cliente VPN e reconectar',
      '6. Validar acesso a recurso interno após reconexão',
    ],
    validationSteps: [
      'Login AD ok na estação',
      'VPN autentica com nova senha',
      'Acesso interno validado',
    ],
    incidentTree: [
      'Senha errada → reset AD + atualizar VPN',
      'Conta bloqueada → desbloqueio + reset',
      'AD ok mas VPN falha → perfil/certificado',
    ],
    rollbackOrSafeExit: ['Reverter bloqueio acidental de conta após validação com gestor'],
    escalationWhen: ['Reset não permitido pelo perfil do solicitante', 'MFA/2FA corporativo envolvido'],
    prevention: ['Comunicar procedimento de reset e canal oficial'],
    knownFalsePositives: ['Usuário confunde senha VPN com senha de aplicação interna'],
  },

  vpn_resource_access: {
    scenario: 'vpn_resource_access',
    titleSuffix: 'VPN conectada — recurso interno inacessível',
    context: 'VPN aparentemente conectada, mas share/RDP/serviço interno não responde.',
    symptoms: [
      'VPN mostra conectada mas share/RDP não abre',
      'Timeout ao acessar servidor de arquivos',
      'Permissão negada em recurso que funcionava antes',
    ],
    likelyCauses: [
      'Rotas split-tunnel incorretas — tráfego interno não passa pelo túnel',
      'Permissão NTFS/share revogada',
      'Servidor de destino offline',
      'DNS interno não resolvendo hostname',
    ],
    triageQuestions: [
      'VPN está realmente conectada (IP interno atribuído)?',
      'Acesso por IP funciona e por nome não?',
      'Outros usuários acessam o mesmo recurso?',
    ],
    commandsOrChecks: [
      'Ping/nslookup ao hostname interno (consultivo)',
      'Testar \\\\IP\\share vs \\\\hostname\\share',
      'Verificar mapeamento de unidade existente',
    ],
    resolutionSteps: [
      '1. Confirmar sessão VPN ativa e IP/rota interna',
      '2. Testar conectividade ao servidor por IP',
      '3. Se IP ok e nome falha → DNS interno ou hosts',
      '4. Se conecta mas acesso negado → validar permissão share/NTFS com admin file server',
      '5. Se servidor offline → escalar para equipe de infra/servidor',
      '6. Remapear unidade de rede com credencial correta se necessário',
    ],
    validationSteps: [
      'Recurso interno abre com usuário final',
      'Persistência após reconectar VPN',
    ],
    incidentTree: [
      'Sem rota → perfil VPN/DNS',
      'Permissão → AD/grupo/share',
      'Servidor down → infra',
    ],
    rollbackOrSafeExit: ['Desfazer alteração de mapeamento de teste'],
    escalationWhen: ['Alteração de permissão em servidor de produção', 'Servidor crítico offline'],
    prevention: ['Documentar caminho UNC padrão e grupos de acesso'],
    knownFalsePositives: ['VPN desconectada em background — usuário não percebeu'],
  },

  office_activation: {
    scenario: 'office_activation',
    titleSuffix: 'Office / M365 — falha de ativação',
    context: 'Office não ativa ou pede licença. Evidências históricas: reparo online + validação M365 resolvem.',
    symptoms: [
      'Office exige ativação ou mostra produto não licenciado',
      'Aplicativo abre em modo limitado',
      'Erro 0x4004, conta errada ou "não podemos verificar a licença"',
    ],
    likelyCauses: [
      'Conta Microsoft errada ou sem licença M365 atribuída',
      'Cache de licenciamento corrompido',
      'Instalação Office corrompida ou upgrade incompleto',
      'Múltiplas instalações conflitantes ( MSI + Click-to-Run )',
    ],
    triageQuestions: [
      'Qual app falha (Word, Excel, Outlook, todos)?',
      'Qual conta aparece em Arquivo > Conta?',
      'Erro começou após update ou troca de máquina?',
    ],
    commandsOrChecks: [
      'Office: Arquivo > Conta — verificar e-mail e status de produto',
      'Portal M365 (admin): licença ativa para o usuário (consultivo)',
      'Programs and Features: versão Click-to-Run vs MSI',
    ],
    resolutionSteps: [
      '1. Abrir Word/Excel > Arquivo > Conta — anotar conta conectada',
      '2. Se conta errada: Sair e entrar com UPN corporativo (@empresa)',
      '3. No portal M365 (admin): confirmar licença Business/Enterprise ativa',
      '4. Executar Reparo Rápido; se persistir, Reparo Online (mantém conexão)',
      '5. Reiniciar máquina e testar ativação',
      '6. Se falhar: desinstalar Office completamente e reinstalar canal corporativo aprovado',
      '7. Validar ativação em 2 apps (ex.: Word + Outlook)',
    ],
    validationSteps: [
      'Arquivo > Conta mostra produto ativado',
      'Apps abrem sem banner de ativação',
      'Usuário confirma envio/recebimento de e-mail se Outlook envolvido',
    ],
    incidentTree: [
      'Conta errada → trocar UPN',
      'Sem licença → admin M365',
      'Corrupção → reparo/reinstalação',
    ],
    rollbackOrSafeExit: ['Restaurar perfil Outlook de backup se perfil novo criado em teste'],
    escalationWhen: ['Licenciamento bloqueado no tenant', 'Reinstalação em máquina crítica'],
    prevention: ['Padronizar imagem corporativa com Office pré-licenciado'],
    knownFalsePositives: ['Licença ok mas cache — reparo online resolve'],
  },

  outlook_issue: {
    scenario: 'outlook_issue',
    titleSuffix: 'Outlook — e-mail / perfil',
    context: 'Problemas de Outlook: perfil, sincronização, PST/OST, conectividade Exchange/M365.',
    symptoms: [
      'Outlook não abre ou trava na inicialização',
      'E-mails não sincronizam',
      'Erro de conexão ao Exchange Online',
      'Caixa cheia ou perfil corrompido',
    ],
    likelyCauses: [
      'Perfil Outlook corrompido (OST)',
      'Credencial expirada no Gerenciador de Credenciais',
      'Cache mode / mailbox grande',
      'Conectividade ou proxy bloqueando M365',
    ],
    triageQuestions: [
      'Outlook Web (OWA) funciona com mesma conta?',
      'Erro ao abrir ou só ao enviar/receber?',
      'Tamanho aproximado da caixa?',
    ],
    commandsOrChecks: [
      'Testar https://outlook.office.com com mesma conta',
      'Outlook: modo seguro (hold Ctrl ao abrir)',
      'Verificar credenciais Windows > Gerenciador de Credenciais',
    ],
    resolutionSteps: [
      '1. Confirmar OWA funciona — isola problema local vs serviço',
      '2. Se OWA ok: fechar Outlook, abrir modo seguro',
      '3. Reparar perfil: Painel de Controle > Mail > Perfis > Reparar',
      '4. Se persistir: criar novo perfil Outlook e reconfigurar conta M365',
      '5. Limpar credenciais Office/Outlook antigas no Gerenciador de Credenciais',
      '6. Executar reparo Office Online se erro de licença/conexão',
    ],
    validationSteps: [
      'Outlook envia e recebe teste',
      'Calendário sincroniza',
      'Sem erro na barra de status',
    ],
    incidentTree: [
      'OWA falha → M365/conectividade',
      'OWA ok → perfil local/OST',
    ],
    rollbackOrSafeExit: ['Voltar ao perfil Outlook anterior se backup existir'],
    escalationWhen: ['Mailbox bloqueada no tenant', 'Litigation hold / quota'],
    prevention: ['Monitorar tamanho de caixa e arquivamento'],
    knownFalsePositives: ['Modo offline ativado pelo usuário'],
  },

  network_share: {
    scenario: 'network_share',
    titleSuffix: 'Acesso a compartilhamento de arquivos',
    context: 'Usuário não acessa pasta/share de rede (UNC). Pode ser VPN, DNS, permissão ou servidor.',
    symptoms: [
      'Erro "Windows não acessou \\\\servidor\\share"',
      'Credencial solicitada repetidamente',
      'Acesso negado mesmo com VPN',
    ],
    likelyCauses: [
      'Permissão NTFS/share insuficiente',
      'Credencial cacheada errada',
      'Servidor offline ou serviço Server desabilitado',
      'VPN/rota ausente para rede do file server',
    ],
    triageQuestions: [
      'Caminho UNC exato?',
      'Funciona para colega do mesmo grupo?',
      'VPN conectada se acesso externo?',
    ],
    commandsOrChecks: [
      'Testar \\\\IP\\share',
      'net use (consultivo) — sessões mapeadas',
      'Ping ao servidor de arquivos',
    ],
    resolutionSteps: [
      '1. Confirmar VPN se usuário remoto',
      '2. Testar por IP — se ok, corrigir DNS',
      '3. net use /delete e remapear com credencial correta',
      '4. Validar grupo AD com permissão na pasta',
      '5. Escalar ao admin do file server se permissão ok mas acesso negado persiste',
    ],
    validationSteps: ['Usuário abre pasta e grava arquivo de teste', 'Persiste após reboot'],
    incidentTree: ['Rede → VPN/DNS', 'Credencial → net use', 'Permissão → AD/NTFS'],
    rollbackOrSafeExit: ['Remover mapeamento de teste'],
    escalationWhen: ['Alteração ACL em produção', 'Servidor de arquivos crítico offline'],
    prevention: ['Documentar UNC e grupos de acesso padrão'],
    knownFalsePositives: ['Usuário digita UNC errado'],
  },

  printer: {
    scenario: 'printer',
    titleSuffix: 'Impressora — instalação e falha de impressão',
    context: 'Impressora local/rede não imprime, fila travada ou driver incorreto.',
    symptoms: [
      'Documento preso na fila',
      'Impressora offline',
      'Driver não encontrado',
      'Impressão em branco ou com caracteres errados',
    ],
    likelyCauses: [
      'Serviço spooler travado',
      'Driver incorreto ou corrompido',
      'Impressora rede inacessível (IP/porta)',
      'Impressora padrão errada',
    ],
    triageQuestions: [
      'Impressora local USB ou rede?',
      'Outros usuários imprimem na mesma impressora?',
      'Teste de página funciona?',
    ],
    commandsOrChecks: [
      'Painel de impressoras — status Online/Offline',
      'Reiniciar serviço Print Spooler (consultivo)',
      'Ping IP da impressora de rede',
    ],
    resolutionSteps: [
      '1. Verificar cabo/rede e impressora ligada',
      '2. Cancelar fila e reiniciar spooler',
      '3. Remover impressora e reinstalar driver aprovado',
      '4. Para rede: confirmar IP fixo/reserva DHCP',
      '5. Imprimir página de teste',
    ],
    validationSteps: ['Página de teste ok', 'Usuário imprime documento real'],
    incidentTree: ['Local → driver/spooler', 'Rede → IP/firewall', 'Compartilhada → servidor print'],
    rollbackOrSafeExit: ['Restaurar driver anterior se novo piorou'],
    escalationWhen: ['Impressora gerenciada por contrato terceiro'],
    prevention: ['Padronizar drivers no servidor de print'],
    knownFalsePositives: ['Impressora em erro de papel/tinta reportado como offline'],
  },

  micromed: {
    scenario: 'micromed',
    titleSuffix: 'Micromed — aplicação não abre / erro',
    context: 'Software Micromed (terceiro) — falha ao abrir, login ou integração.',
    symptoms: [
      'Aplicação não inicia ou fecha sozinha',
      'Erro de banco/conexão ao abrir',
      'Lentidão após update Windows',
    ],
    likelyCauses: [
      'Serviço dependente parado',
      'Permissão insuficiente (executar como admin)',
      'Antivírus bloqueando executável',
      'Banco local/SQL Express indisponível',
    ],
    triageQuestions: [
      'Erro exato na tela ou Event Viewer?',
      'Funcionava antes de update?',
      'Instalação local ou terminal server?',
    ],
    commandsOrChecks: [
      'Verificar serviços Micromed/SQL relacionados (services.msc — consultivo)',
      'Event Viewer > Application no horário da falha',
      'Executar como administrador (teste)',
    ],
    resolutionSteps: [
      '1. Coletar print do erro e versão do Micromed',
      '2. Verificar serviços dependentes e iniciar se parados',
      '3. Exceção temporária AV (com autorização) — testar abertura',
      '4. Reparar instalação pelo instalador oficial se disponível',
      '5. Escalar ao suporte Micromed/fornecedor se erro de banco/licença',
    ],
    validationSteps: ['App abre e usuário acessa módulo usado no dia a dia'],
    incidentTree: ['Serviço → start/repair', 'AV → exceção', 'DB → fornecedor'],
    rollbackOrSafeExit: ['Restaurar backup de banco local se alteração de teste'],
    escalationWhen: ['Corrupção de banco', 'Licença expirada'],
    prevention: ['Checklist pós-update Windows para Micromed'],
    knownFalsePositives: ['Usuário sem permissão no módulo específico'],
  },

  backup_restore: {
    scenario: 'backup_restore',
    titleSuffix: 'Backup e restauração',
    context: 'Backup falhou, restore necessário (Synology, Veeam, Hyper Backup).',
    symptoms: [
      'Job de backup falhou',
      'Arquivo/pasta precisa ser restaurado de ponto anterior',
      'Repositório cheio ou inacessível',
    ],
    likelyCauses: [
      'Espaço insuficiente no repositório',
      'Credencial de destino expirada',
      'Arquivo em uso bloqueando backup',
      'Snapshot corrompido (raro)',
    ],
    triageQuestions: [
      'Qual produto (Synology, Veeam, outro)?',
      'Restore granular de arquivo ou VM completa?',
      'Qual data/hora do ponto de restore?',
    ],
    commandsOrChecks: [
      'Console backup: último job e erro',
      'Espaço livre no repositório',
      'Integridade do último backup bem-sucedido (consultivo)',
    ],
    resolutionSteps: [
      '1. Identificar erro exato do job no console de backup',
      '2. Liberar espaço ou ajustar retenção conforme política',
      '3. Para restore: selecionar versão/datetime no Hyper Backup/Veeam',
      '4. Restaurar para pasta alternativa (não sobrescrever produção)',
      '5. Validar checksum/arquivo restaurado com solicitante',
      '6. Reexecutar backup manual após correção',
    ],
    validationSteps: ['Job backup verde', 'Arquivo restaurado íntegro e acessível'],
    incidentTree: ['Espaço → retenção', 'Credencial → atualizar', 'Restore → versão correta'],
    rollbackOrSafeExit: ['Não sobrescrever produção — restore em pasta _restore_review'],
    escalationWhen: ['Restore de VM crítica', 'Corrupção de repositório'],
    prevention: ['Alertas de espaço e job falho'],
    knownFalsePositives: ['Backup ok mas usuário procura arquivo já excluído antes da janela de retenção'],
  },

  windows_server: {
    scenario: 'windows_server',
    titleSuffix: 'Windows Server — operação e acesso',
    context: 'Tarefas comuns em Windows Server: usuário, serviço, disco, RDP.',
    symptoms: [
      'Serviço Windows parado',
      'Disco cheio',
      'Usuário não consegue RDP',
      'Criação de usuário/grupo necessária',
    ],
    likelyCauses: [
      'Serviço desabilitado ou dependência falhou',
      'Log/dados consumindo disco',
      'Licenças RDP CAL ou limite de sessão',
      'Permissão RDP não concedida',
    ],
    triageQuestions: [
      'Qual serviço/servidor/host?',
      'Mensagem RDP exata?',
      'Alteração recente no servidor?',
    ],
    commandsOrChecks: [
      'services.msc — status do serviço',
      'Espaço em disco (consultivo)',
      'Grupo Remote Desktop Users',
    ],
    resolutionSteps: [
      '1. Identificar serviço/sintoma específico',
      '2. Verificar logs Application/System no horário',
      '3. Iniciar serviço e dependências; definir automático se aplicável',
      '4. Para disco: limpar logs/temp conforme runbook aprovado',
      '5. Para RDP: validar grupo, firewall e NLA',
      '6. Documentar alteração e janela de manutenção se produção',
    ],
    validationSteps: ['Serviço running', 'Usuário confirma acesso'],
    incidentTree: ['Serviço → dependência', 'RDP → grupo/firewall', 'Disco → limpeza'],
    rollbackOrSafeExit: ['Reverter alteração de serviço se piorou'],
    escalationWhen: ['Servidor domain controller', 'Reboot em produção necessário'],
    prevention: ['Monitoramento de disco e serviços críticos'],
    knownFalsePositives: ['RDP bloqueado por horário comercial via GPO'],
  },

  critical_incident: {
    scenario: 'critical_incident',
    titleSuffix: 'Incidente crítico — indisponibilidade',
    context: 'Playbook para serviço indisponível, erro 5xx, timeout ou degradação severa.',
    symptoms: [
      'Serviço indisponível para todos ou subset de usuários',
      'HTTP 5xx, timeout, connection refused',
      'CPU/RAM/disco saturados',
    ],
    likelyCauses: [
      'Deploy recente com regressão',
      'Sobrecarga ou leak de memória',
      'Falha de dependência (DB, cache, LB)',
      'Rede/firewall alterado',
    ],
    triageQuestions: [
      'Desde quando e escopo (100% ou parcial)?',
      'Deploy/change recente?',
      'Monitoramento aponta qual camada?',
    ],
    commandsOrChecks: [
      'Status do serviço e dependências',
      'CPU/RAM/disco no host',
      'Logs de aplicação no intervalo do incidente',
      'Teste de conectividade entre tiers',
    ],
    resolutionSteps: [
      '1. Confirmar impacto e comunicar stakeholders',
      '2. Isolar camada: rede → SO → app → DB',
      '3. Correlacionar com deploy/change',
      '4. Mitigar: restart controlado, scale, rollback de release',
      '5. Validar saúde com teste sintético',
      '6. RCA e ticket filho se necessário',
    ],
    validationSteps: [
      'Monitoramento verde',
      'Teste funcional crítico ok',
      'Sem erro nos logs por janela acordada',
    ],
    incidentTree: [
      'Total → infra/LB/DB',
      'Parcial → app específica',
      'Intermitente → carga/timeout',
    ],
    rollbackOrSafeExit: [
      'Rollback de deploy conforme runbook aprovado',
      'Restaurar snapshot/backup se alteração de infra falhou',
    ],
    escalationWhen: ['SLA crítico estourado', 'Dados em risco'],
    prevention: ['Change management + rollback testado'],
    knownFalsePositives: ['CDN/DNS externo vs app interna'],
  },

  reopen_ticket: {
    scenario: 'reopen_ticket',
    titleSuffix: 'Chamado reaberto — validar solução',
    context: 'Cliente reabriu chamado — retrabalho ou solução incompleta.',
    symptoms: [
      'Chamado voltou após SOLVED/CLOSED',
      'Cliente reporta mesmo sintoma',
      'Solução anterior não validada',
    ],
    likelyCauses: [
      'Encerramento sem validação do usuário',
      'Causa raiz não tratada (workaround)',
      'Novo sintoma confundido com reincidência',
    ],
    triageQuestions: [
      'É o mesmo sintoma ou novo?',
      'O que foi feito no encerramento anterior?',
      'Há checklist de validação preenchido?',
    ],
    commandsOrChecks: [
      'Ler histórico completo do ticket pai',
      'Comparar data/hora reabertura vs encerramento',
    ],
    resolutionSteps: [
      '1. Ler solução anterior e confirmar com cliente o que persiste',
      '2. Se sintoma igual: reabrir diagnóstico — não repetir workaround falho',
      '3. Se novo sintoma: documentar escopo novo',
      '4. Executar checklist de validação antes de novo SOLVED',
      '5. Registrar causa raiz real',
    ],
    validationSteps: [
      'Cliente confirma por escrito que problema resolvido',
      'Checklist de encerramento completo',
    ],
    incidentTree: ['Mesmo sintoma → RCA', 'Novo sintoma → novo escopo'],
    rollbackOrSafeExit: ['Reassociar ticket se encerramento errado'],
    escalationWhen: ['3+ reaberturas no mesmo ticket'],
    prevention: ['Confirmação explícita antes de SOLVED'],
    knownFalsePositives: ['Cliente reabriu por dúvida operacional'],
  },

  csat_satisfaction: {
    scenario: 'csat_satisfaction',
    titleSuffix: 'Pesquisa de satisfação / CSAT',
    context: 'Interação inicial ou follow-up de satisfação — não é procedimento técnico.',
    symptoms: ['Cliente recebe pesquisa CSAT', 'Dúvida sobre nota ou processo'],
    likelyCauses: ['Expectativa não alinhada', 'Comunicação do encerramento'],
    triageQuestions: ['Cliente satisfeito com a solução técnica?', 'Nota reflete tempo ou qualidade?'],
    commandsOrChecks: ['Verificar se ticket foi resolvido tecnicamente'],
    resolutionSteps: [
      '1. Confirmar se problema técnico ainda existe — se sim, tratar como incidente',
      '2. Se resolvido: agradecer feedback e registrar no ticket',
      '3. Nota baixa: escalar para supervisor conforme política CSAT',
    ],
    validationSteps: ['Ticket reflete status correto'],
    incidentTree: ['Problema técnico → suporte', 'Só CSAT → processo'],
    rollbackOrSafeExit: [],
    escalationWhen: ['Reclamação formal'],
    prevention: ['Comunicar encerramento claro'],
    knownFalsePositives: [],
  },

  ad_sync: {
    scenario: 'ad_sync',
    titleSuffix: 'Active Directory / Azure AD Connect — sincronização',
    context: 'Falha ou conflito na sincronização híbrida AD ↔ Azure AD (Azure AD Connect).',
    symptoms: [
      'Usuários não sincronizam para nuvem ou vice-versa',
      'Erros no Azure AD Connect sync cycle',
      'Atributos divergentes entre AD local e Entra ID',
      'Contas duplicadas ou soft-match pendente',
    ],
    likelyCauses: [
      'Conflito de atributos (UPN, proxyAddresses, mail)',
      'Serviço Azure AD Connect parado ou credencial expirada',
      'OU fora do escopo de sync',
      'Conta genérica ou de serviço mal configurada',
    ],
    triageQuestions: [
      'Qual direção falha (AD→AAD ou AAD→AD)?',
      'Erro exato no Synchronization Service Manager?',
      'Mudança recente em UPN, OU ou filtro de sync?',
    ],
    commandsOrChecks: [
      'Azure AD Connect: Synchronization Service Manager — último sync e erros',
      'Verificar status do serviço ADSync (consultivo)',
      'Identificar objeto(s) em quarentena ou com sync error',
    ],
    resolutionSteps: [
      '1. Abrir Synchronization Service Manager e anotar erro do último ciclo',
      '2. Identificar objeto(s) com DuplicateAttribute ou quarentena',
      '3. Corrigir UPN/proxyAddresses conflitantes no AD local (fonte autoritativa)',
      '4. Forçar delta sync após correção (consultivo — janela aprovada)',
      '5. Validar objeto no Entra ID e no AD',
      '6. Documentar causa (conta genérica, OU, atributo) e ação preventiva',
    ],
    validationSteps: [
      'Ciclo de sync concluído sem erro',
      'Usuário/objeto aparece corretamente no destino',
      'Sem novos conflitos no próximo ciclo',
    ],
    incidentTree: [
      'Atributo duplicado → corrigir UPN/mail',
      'Serviço parado → reiniciar ADSync',
      'Escopo OU → ajustar filtros com admin identidade',
    ],
    rollbackOrSafeExit: ['Reverter alteração de atributo se piorou — restaurar backup AD se disponível'],
    escalationWhen: ['Conflito em massa (>10 objetos)', 'Necessidade de alterar regras de sync produção'],
    prevention: ['Padronizar UPN; evitar contas genéricas compartilhadas', 'Monitorar sync errors diariamente'],
    knownFalsePositives: ['Delay normal de replicação — aguardar 1 ciclo completo'],
  },

  internet_connectivity: {
    scenario: 'internet_connectivity',
    titleSuffix: 'Internet / firewall — conectividade',
    context: 'Queda ou instabilidade de internet; firewall/gateway (ex.: pfSense) envolvido.',
    symptoms: [
      'Internet lenta ou indisponível na unidade',
      'Firewall/gateway reiniciando ou travando',
      'Perda intermitente de pacotes',
    ],
    likelyCauses: [
      'Saturação ou crash do firewall/gateway',
      'Link WAN do provedor instável',
      'Regra/firewall alterada recentemente',
      'Hardware/virtualização do gateway com recurso esgotado',
    ],
    triageQuestions: [
      'Escopo: site inteiro ou subset de VLAN?',
      'Gateway responde management? WAN up?',
      'Incidente correlacionado com change no firewall?',
    ],
    commandsOrChecks: [
      'Ping/traceroute para destino externo (consultivo)',
      'Console pfSense/gateway — status interfaces WAN/LAN',
      'Verificar logs do firewall no horário da queda',
    ],
    resolutionSteps: [
      '1. Confirmar escopo com usuários locais e monitoramento',
      '2. Acessar console do firewall/gateway (management)',
      '3. Verificar interface WAN link up e IP válido',
      '4. Reinício controlado do serviço/firewall se travado (janela aprovada)',
      '5. Escalar ao provedor WAN se link externo down',
      '6. Validar navegação e apps críticos após normalização',
    ],
    validationSteps: [
      'Ping externo estável por janela acordada',
      'Usuários confirmam acesso',
      'Monitoramento verde',
    ],
    incidentTree: ['WAN down → provedor', 'Gateway crash → infra/firewall', 'LAN ok WAN ok → DNS/upstream'],
    rollbackOrSafeExit: ['Reverter regra de firewall de teste'],
    escalationWhen: ['Firewall produção instável', 'Múltiplos sites afetados'],
    prevention: ['Monitoramento WAN + alertas de CPU/memória no gateway'],
    knownFalsePositives: ['Problema DNS local — internet aparenta down'],
  },

  generic_it: {
    scenario: 'generic_it',
    titleSuffix: 'Suporte TI — diagnóstico estruturado',
    context: 'Procedimento genérico quando cenário específico não foi detectado — ainda acionável.',
    symptoms: ['Sintoma reportado pelo usuário', 'Impacto operacional a confirmar'],
    likelyCauses: ['A identificar na triagem', 'Configuração local', 'Serviço dependente'],
    triageQuestions: [
      'Sintoma exato e horário de início?',
      'Afeta só este usuário ou vários?',
      'Mudança recente (update, software novo)?',
    ],
    commandsOrChecks: [
      'Reproduzir problema com usuário na linha',
      'Coletar print/log do erro',
      'Verificar serviços relacionados (consultivo)',
    ],
    resolutionSteps: [
      '1. Confirmar sintoma, escopo e urgência com solicitante',
      '2. Reproduzir e registrar evidência objetiva (print/log)',
      '3. Isolar camada: usuário → rede → serviço → aplicação',
      '4. Aplicar correção mínima documentada em KB específica se existir',
      '5. Validar com usuário antes de encerrar',
      '6. Atualizar ou criar KB se padrão novo',
    ],
    validationSteps: [
      'Usuário confirma resolução',
      'Causa raiz documentada',
    ],
    incidentTree: ['Individual → estação local', 'Múltiplos → serviço compartilhado'],
    rollbackOrSafeExit: ['Reverter alteração de teste'],
    escalationWhen: ['Sem progresso após 30 min', 'Risco a produção'],
    prevention: ['Documentar solução no ticket e KB'],
    knownFalsePositives: ['Erro intermitente não reproduzido'],
  },
};

export function getQualityPlaybook(scenario: KbScenario): QualityPlaybook {
  return PLAYBOOKS[scenario];
}

export function mergePlaybookWithRecord(
  playbook: QualityPlaybook,
  r: AgentCandidateRecord,
  evidenceSymptoms: string[],
): QualityPlaybook {
  const title = String(r.title ?? '');
  return {
    ...playbook,
    symptoms: uniqueStrings([...playbook.symptoms, ...evidenceSymptoms], 10),
    resolutionSteps: uniqueStrings(playbook.resolutionSteps, 12),
    likelyCauses: playbook.likelyCauses.filter((c) => !c.includes('revisar evidencias')),
    context: playbook.context + (title ? ` Ref.: ${title.slice(0, 80)}.` : ''),
  };
}

function uniqueStrings(items: string[], limit: number): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of items) {
    const v = raw.trim();
    if (v.length < 4 || seen.has(v.toLowerCase())) continue;
    seen.add(v.toLowerCase());
    out.push(v);
    if (out.length >= limit) break;
  }
  return out;
}
