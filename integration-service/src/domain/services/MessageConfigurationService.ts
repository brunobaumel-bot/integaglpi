import { logger } from '../../infra/logger/logger.js';
import type {
  ConfiguredMessage,
  ConfiguredMessageSendType,
  MessageFlowRepository,
  RecordInactivityJobEventInput,
} from '../../repositories/contracts/MessageFlowRepository.js';

export interface MessageSendPlan {
  eventKey: string;
  sendType: ConfiguredMessageSendType;
  text: string;
  active: boolean;
  shouldSend: boolean;
  reason: string | null;
  templateName: string | null;
  language: string;
  buttons: ConfiguredMessage['buttons'];
  listOptions: ConfiguredMessage['listOptions'];
}

export interface MessageSendContext {
  windowOpen: boolean;
  allowTemplateSend?: boolean;
  placeholderValues?: Partial<Record<MessagePlaceholderKey, string | number | null | undefined>>;
}

export const MESSAGE_PLACEHOLDER_KEYS = [
  'nome',
  'empresa',
  'ticket_id',
  'fila',
  'protocolo',
  'tecnico',
  'entidade',
  'horario_atendimento',
  'email',
  'telefone_mascarado',
  'link_ticket',
] as const;

export type MessagePlaceholderKey = typeof MESSAGE_PLACEHOLDER_KEYS[number];

const MESSAGE_PLACEHOLDER_KEY_SET = new Set<string>(MESSAGE_PLACEHOLDER_KEYS);

const MESSAGE_PLACEHOLDER_FALLBACKS: Record<MessagePlaceholderKey, string> = {
  nome: 'cliente',
  empresa: 'empresa',
  ticket_id: 'chamado',
  fila: 'fila de atendimento',
  protocolo: 'protocolo',
  tecnico: 'técnico',
  entidade: 'entidade',
  horario_atendimento: 'horário de atendimento',
  email: 'e-mail cadastrado',
  telefone_mascarado: '+55******0000',
  link_ticket: 'link do chamado',
};

export const MESSAGE_EVENT_DEFAULTS: Record<string, { group: string; description: string; text: string; expectsResponse?: boolean }> = {
  welcome_message: {
    group: 'Boas-vindas e Fila',
    description: 'Mensagem inicial do atendimento',
    text: 'Olá! Como podemos ajudar?',
    expectsResponse: true,
  },
  queue_selection_prompt: {
    group: 'Boas-vindas e Fila',
    description: 'Solicita escolha de fila',
    text: 'Escolha uma das opções de atendimento.',
    expectsResponse: true,
  },
  invalid_queue_selection: {
    group: 'Boas-vindas e Fila',
    description: 'Opção de fila inválida',
    text: 'Por favor, responda com uma opção válida do menu.',
    expectsResponse: true,
  },
  profile_name_prompt: {
    group: 'Coleta de Perfil',
    description: 'Solicita nome',
    text: 'Por favor, informe seu nome. Se quiser encerrar este atendimento, digite cancelar a qualquer momento.',
    expectsResponse: true,
  },
  profile_company_prompt: {
    group: 'Coleta de Perfil',
    description: 'Solicita empresa',
    text: 'Por favor, informe a empresa. Se quiser encerrar este atendimento, digite cancelar a qualquer momento.',
    expectsResponse: true,
  },
  profile_email_prompt: {
    group: 'Coleta de Perfil',
    description: 'Solicita e-mail',
    text: 'Se tiver, informe seu e-mail para cadastro. Se quiser encerrar, digite cancelar a qualquer momento.',
    expectsResponse: true,
  },
  profile_equipment_prompt: {
    group: 'Coleta de Perfil',
    description: 'Solicita equipamento',
    text: 'Informe o equipamento ou sistema afetado. Se quiser encerrar, digite cancelar a qualquer momento.',
    expectsResponse: true,
  },
  profile_reason_prompt: {
    group: 'Coleta de Perfil',
    description: 'Solicita motivo',
    text: 'Descreva resumidamente o problema. Se quiser encerrar este atendimento, digite cancelar a qualquer momento.',
    expectsResponse: true,
  },
  profile_confirmation_prompt: { group: 'Coleta de Perfil', description: 'Confirma dados coletados', text: 'Confirma as informações para abrir o chamado?', expectsResponse: true },
  profile_confirmed_message: { group: 'Coleta de Perfil', description: 'Perfil confirmado', text: 'Dados registrados. Vamos abrir seu chamado.' },
  profile_collection_reminder: {
    group: 'Coleta de Perfil',
    description: 'Lembrete unico de pre-ticket incompleto',
    text: 'Ainda precisamos confirmar algumas informações para continuar seu atendimento. Por favor, responda as perguntas pendentes para seguirmos. Se quiser encerrar, digite cancelar a qualquer momento.',
    expectsResponse: true,
  },
  preticket_reminder: {
    group: 'Coleta de Perfil',
    description: 'Lembrete de pré-ticket incompleto',
    text: 'Ainda precisamos confirmar algumas informações para continuar seu atendimento. Por favor, responda as perguntas pendentes para seguirmos. Se quiser encerrar, digite cancelar a qualquer momento.',
    expectsResponse: true,
  },
  preticket_autoclose: {
    group: 'Coleta de Perfil',
    description: 'Cancelamento de pré-ticket por falta de resposta',
    text: 'Como não tivemos retorno, encerramos este pré-atendimento sem abrir chamado. Se precisar, inicie um novo atendimento.',
  },
  preticket_invalid_input: {
    group: 'Coleta de Perfil',
    description: 'Entrada inválida durante questionário textual',
    text: 'Neste momento preciso que você responda em texto. Envie uma breve descrição do problema. Se quiser encerrar, digite cancelar.',
    expectsResponse: true,
  },
  preticket_cancelled_by_user: {
    group: 'Coleta de Perfil',
    description: 'Pré-ticket cancelado pelo usuário',
    text: 'Atendimento cancelado. Nenhum chamado foi aberto. Se precisar, inicie um novo atendimento.',
  },
  awaiting_entity_message: { group: 'Ticket e Solução', description: 'Aguardando seleção de entidade', text: 'Recebemos as suas informações, em breve um técnico seguirá com o atendimento.' },
  ticket_created_message: { group: 'Ticket e Solução', description: 'Chamado criado', text: 'Seu chamado #{ticket_id} foi aberto.' },
  ticket_updated_message: { group: 'Ticket e Solução', description: 'Chamado atualizado', text: 'Atualizamos seu chamado com a nova mensagem.' },
  entity_updated_message: { group: 'Ticket e Solução', description: 'Entidade da conversa atualizada', text: 'A entidade da conversa foi atualizada.' },
  technician_transfer_message: { group: 'Ticket e Solução', description: 'Transferência de técnico', text: 'Seu atendimento foi encaminhado para outro técnico.' },
  technician_assumed_message: { group: 'Ticket e Solução', description: 'Técnico assumiu atendimento', text: 'Um técnico assumiu seu atendimento e seguirá por aqui.' },
  inactivity_reminder_1: { group: 'Avisos e Inatividade', description: 'Primeiro lembrete de inatividade', text: 'Olá! Estamos aguardando seu retorno para continuar o atendimento. Podemos ajudar em algo mais?', expectsResponse: true },
  inactivity_reminder_2: { group: 'Avisos e Inatividade', description: 'Segundo lembrete de inatividade', text: 'Ainda estamos por aqui. Para seguirmos com o chamado, responda esta mensagem quando puder.', expectsResponse: true },
  inactivity_reminder_3: { group: 'Avisos e Inatividade', description: 'Terceiro lembrete de inatividade', text: 'Como ainda não tivemos retorno, este atendimento poderá ser encerrado automaticamente se não houver resposta.', expectsResponse: true },
  inactivity_autoclose_warning: { group: 'Avisos e Inatividade', description: 'Aviso antes do encerramento', text: 'Este atendimento poderá ser encerrado automaticamente se não houver resposta.' },
  inactivity_autoclose_message: { group: 'Avisos e Inatividade', description: 'Mensagem final de inatividade', text: 'Como não tivemos retorno, estamos encerrando este atendimento por falta de resposta. Se precisar, basta nos chamar novamente.' },
  solution_submitted_message: { group: 'Ticket e Solução', description: 'Solução enviada', text: 'Seu chamado foi solucionado.' },
  solution_approve_reopen_prompt: { group: 'Ticket e Solução', description: 'Aprovação ou reabertura', text: 'A solução atendeu sua necessidade? Toque no botão ou digite: 1 - Aprovar, 2 - Reabrir.' },
  solution_approved_message: { group: 'Ticket e Solução', description: 'Solução aprovada', text: 'Obrigado pela confirmação.' },
  solution_reopen_message: { group: 'Ticket e Solução', description: 'Solução reaberta', text: 'Vamos reabrir o atendimento para continuidade.' },
  solution_approved_confirmation: { group: 'Ticket e Solução', description: 'Confirmação de aprovação', text: 'Obrigado pela confirmação.' },
  solution_reopened_confirmation: { group: 'Ticket e Solução', description: 'Confirmação de reabertura', text: 'Seu chamado #{ticket_id} foi reaberto com sucesso.' },
  reopen_reason_prompt: { group: 'Ticket e Solução', description: 'Solicita motivo de reabertura', text: 'Qual o motivo da reabertura?', expectsResponse: true },
  reopen_reason_problem_persists: { group: 'Ticket e Solução', description: 'Motivo de reabertura: problema permanece', text: 'O problema permanece', expectsResponse: true },
  reopen_reason_missing_work: { group: 'Ticket e Solução', description: 'Motivo de reabertura: ficou faltando algo', text: 'Ficou faltando algo', expectsResponse: true },
  reopen_reason_not_understood: { group: 'Ticket e Solução', description: 'Motivo de reabertura: solução não entendida', text: 'Não entendi a solução', expectsResponse: true },
  reopen_reason_other: { group: 'Ticket e Solução', description: 'Motivo de reabertura: outro motivo', text: 'Outro motivo', expectsResponse: true },
  csat_prompt: { group: 'CSAT', description: 'Pesquisa de satisfação', text: 'Como você avalia este atendimento? Toque no botão ou digite: 1 - Ótimo, 2 - Bom, 3 - Ruim.', expectsResponse: true },
  csat_thanks_message: { group: 'CSAT', description: 'Agradecimento CSAT', text: 'Obrigado pela avaliação.' },
  csat_thank_you_closure: {
    group: 'CSAT',
    description: 'Encerramento após avaliação CSAT',
    text: 'Seu chamado foi encerrado. Obrigado pela avaliação.',
  },
  media_received_message: { group: 'Mídia', description: 'Mídia recebida', text: 'Recebemos o arquivo enviado e vamos analisá-lo.' },
  media_processing_failed_message: { group: 'Mídia', description: 'Falha ao processar mídia', text: 'Não conseguimos processar o arquivo agora. Um técnico vai verificar.' },
  outside_24h_template_required_message: { group: 'Avisos e Inatividade', description: 'Janela 24h fechada', text: 'A janela de 24h está fechada. Use um template aprovado para iniciar contato.' },
  outside_business_hours_message: { group: 'Horário Comercial', description: 'Mensagem fora do horário', text: 'Olá! Nosso horário de atendimento é de segunda a sexta, das 08h às 18h. Recebemos sua mensagem e retornaremos em breve.' },
  outside_business_hours_template_missing: { group: 'Horário Comercial', description: 'Template ausente fora da janela', text: 'Mensagem fora do horário não enviada: janela 24h fechada e template local ausente.' },
  outside_business_hours_cooldown_skipped: { group: 'Horário Comercial', description: 'Cooldown fora do horário', text: 'Mensagem fora do horário suprimida por cooldown.' },
  outside_business_hours_sent: { group: 'Horário Comercial', description: 'Fora do horário enviado', text: 'Mensagem fora do horário enviada.' },
  outside_business_hours_failed: { group: 'Horário Comercial', description: 'Falha fora do horário', text: 'Falha ao enviar mensagem fora do horário.' },
};

const CACHE_TTL_MS = 5 * 60 * 1000;

interface CacheEntry {
  expiresAt: number;
  value: ConfiguredMessage | null;
}

export class MessageConfigurationService {
  private readonly cache = new Map<string, CacheEntry>();

  public constructor(private readonly repository: MessageFlowRepository | null) {}

  public async getMessage(eventKey: string): Promise<ConfiguredMessage> {
    const fallback = fallbackMessage(eventKey);
    if (!this.repository) {
      return fallback;
    }

    const cached = this.cache.get(eventKey);
    const now = Date.now();
    if (cached && cached.expiresAt > now) {
      return cached.value ?? fallback;
    }

    try {
      const configured = await this.repository.findMessageByEventKey(eventKey);
      this.cache.set(eventKey, { value: configured, expiresAt: now + CACHE_TTL_MS });

      return configured ?? fallback;
    } catch (error: unknown) {
      logger.warn(
        {
          event_key: eventKey,
          error: error instanceof Error ? { name: error.name, message: error.message } : String(error),
        },
        '[message_config][FALLBACK]',
      );
      this.cache.set(eventKey, { value: null, expiresAt: now + CACHE_TTL_MS });

      return fallback;
    }
  }

  public async resolveSendPlan(eventKey: string, context: MessageSendContext): Promise<MessageSendPlan> {
    const message = await this.getMessage(eventKey);
    const selectedText = selectMessageText(message);
    const validation = validateMessagePlaceholders(selectedText);
    const text = validation.valid
      ? renderMessagePlaceholders(selectedText, context.placeholderValues)
      : selectMessageText(fallbackMessage(eventKey));

    if (!validation.valid) {
      logger.warn(
        {
          event_key: eventKey,
          invalid_placeholders: validation.invalidPlaceholders,
          malformed_placeholders: validation.malformed,
        },
        '[message_config][PLACEHOLDER_FALLBACK]',
      );
    }

    if (!message.isActive) {
      return buildPlan(message, text, false, 'message_inactive');
    }

    if (message.sendType === 'internal_only') {
      return buildPlan(message, text, false, 'internal_only');
    }

    if (!context.windowOpen && message.sendType !== 'template') {
      return buildPlan(message, text, false, 'skipped_missing_template_outside_24h');
    }

    if (message.sendType === 'template' && !message.templateName) {
      return buildPlan(message, text, false, 'skipped_missing_template_outside_24h');
    }

    if (message.sendType === 'template' && !context.allowTemplateSend) {
      return buildPlan(message, text, false, 'template_send_not_allowed');
    }

    if (text.trim() === '') {
      return buildPlan(message, text, false, 'empty_message');
    }

    return buildPlan(message, text, true, null);
  }

  public async recordAutomationEvent(input: Parameters<NonNullable<MessageFlowRepository['recordAutomationEvent']>>[0]): Promise<void> {
    try {
      await this.repository?.recordAutomationEvent(input);
    } catch (error: unknown) {
      logger.warn(
        {
          event_key: input.eventKey,
          status: input.status,
          error: error instanceof Error ? { name: error.name, message: error.message } : String(error),
        },
        '[message_config][AUTOMATION_AUDIT_FAILED]',
      );
    }
  }

  public async recordInactivityJobEvent(input: RecordInactivityJobEventInput): Promise<void> {
    try {
      await this.repository?.recordInactivityJobEvent(input);
    } catch (error: unknown) {
      logger.warn(
        {
          event_key: input.eventKey,
          status: input.status,
          reason: input.reason,
          error: error instanceof Error ? { name: error.name, message: error.message } : String(error),
        },
        '[message_config][INACTIVITY_DIAGNOSTIC_FAILED]',
      );
    }
  }
}

function fallbackMessage(eventKey: string): ConfiguredMessage {
  const fallback = MESSAGE_EVENT_DEFAULTS[eventKey] ?? {
    group: 'Geral',
    description: eventKey,
    text: '',
  };

  return {
    eventKey,
    description: fallback.description,
    groupName: fallback.group,
    defaultText: fallback.text,
    customText: null,
    isActive: true,
    sendType: 'text',
    language: 'pt_BR',
    fallbackText: null,
    templateName: null,
    buttons: [],
    listOptions: [],
    expectsResponse: fallback.expectsResponse === true,
    updatedAt: null,
    updatedBy: null,
  };
}

function selectMessageText(message: ConfiguredMessage): string {
  const custom = message.customText?.trim() ?? '';
  if (custom !== '') {
    return custom;
  }

  const fallback = message.fallbackText?.trim() ?? '';
  if (message.defaultText.trim() === '' && fallback !== '') {
    return fallback;
  }

  return message.defaultText;
}

function buildPlan(message: ConfiguredMessage, text: string, shouldSend: boolean, reason: string | null): MessageSendPlan {
  return {
    eventKey: message.eventKey,
    sendType: message.sendType,
    text,
    active: message.isActive,
    shouldSend,
    reason,
    templateName: message.templateName,
    language: message.language,
    buttons: message.buttons,
    listOptions: message.listOptions,
  };
}

export function validateMessagePlaceholders(text: string): {
  valid: boolean;
  invalidPlaceholders: string[];
  malformed: boolean;
} {
  const invalidPlaceholders = new Set<string>();
  const validTokens: string[] = [];
  const tokenPattern = /\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g;
  let match: RegExpExecArray | null;

  while ((match = tokenPattern.exec(text)) !== null) {
    const key = match[1];
    validTokens.push(match[0]);
    if (!MESSAGE_PLACEHOLDER_KEY_SET.has(key)) {
      invalidPlaceholders.add(key);
    }
  }

  let remainder = text;
  for (const token of validTokens) {
    remainder = remainder.replace(token, '');
  }
  const malformed = remainder.includes('{{') || remainder.includes('}}');

  return {
    valid: invalidPlaceholders.size === 0 && !malformed,
    invalidPlaceholders: [...invalidPlaceholders],
    malformed,
  };
}

export function renderMessagePlaceholders(
  text: string,
  values: MessageSendContext['placeholderValues'] = {},
): string {
  return text.replace(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g, (token, key: string) => {
    if (!MESSAGE_PLACEHOLDER_KEY_SET.has(key)) {
      return token;
    }

    const placeholderKey = key as MessagePlaceholderKey;
    const value = values?.[placeholderKey];
    const rendered = value === null || value === undefined ? '' : String(value).trim();

    return rendered !== '' ? rendered : MESSAGE_PLACEHOLDER_FALLBACKS[placeholderKey];
  });
}
