CREATE TABLE IF NOT EXISTS public.glpi_plugin_integaglpi_message_catalog (
  event_key TEXT PRIMARY KEY,
  description TEXT NOT NULL,
  group_name TEXT NOT NULL,
  default_text TEXT NOT NULL,
  custom_text TEXT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  send_type TEXT NOT NULL DEFAULT 'text' CHECK (send_type IN ('text', 'interactive_buttons', 'interactive_list', 'template', 'internal_only')),
  language TEXT NOT NULL DEFAULT 'pt_BR',
  fallback_text TEXT NULL,
  template_name TEXT NULL,
  buttons_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  list_options_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  expects_response BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by BIGINT NULL
);

CREATE TABLE IF NOT EXISTS public.glpi_plugin_integaglpi_message_catalog_audit (
  id BIGSERIAL PRIMARY KEY,
  event_key TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('create', 'update', 'disable', 'enable')),
  old_value JSONB NULL,
  new_value JSONB NULL,
  changed_by BIGINT NULL,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.glpi_plugin_integaglpi_business_hours (
  id BIGSERIAL PRIMARY KEY,
  business_hours_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  timezone TEXT NOT NULL DEFAULT 'America/Sao_Paulo',
  weekday_start_time TEXT NOT NULL DEFAULT '08:00',
  weekday_end_time TEXT NOT NULL DEFAULT '18:00',
  saturday_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  saturday_start_time TEXT NULL,
  saturday_end_time TEXT NULL,
  sunday_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  sunday_start_time TEXT NULL,
  sunday_end_time TEXT NULL,
  holiday_behavior TEXT NOT NULL DEFAULT 'normal' CHECK (holiday_behavior IN ('closed', 'normal', 'custom')),
  outside_hours_event_key TEXT NOT NULL DEFAULT 'outside_business_hours_message',
  cooldown_minutes INTEGER NOT NULL DEFAULT 60,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by BIGINT NULL
);

CREATE TABLE IF NOT EXISTS public.glpi_plugin_integaglpi_message_automation_events (
  id BIGSERIAL PRIMARY KEY,
  conversation_id TEXT NULL,
  phone_e164 TEXT NULL,
  event_key TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('planned', 'sent', 'failed', 'not_sent_by_rule')),
  message_id TEXT NULL,
  reason TEXT NULL,
  error_code TEXT NULL,
  error_message_sanitized TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS glpi_intega_msg_catalog_group_idx
  ON public.glpi_plugin_integaglpi_message_catalog (group_name, event_key);

CREATE INDEX IF NOT EXISTS glpi_intega_msg_catalog_audit_event_idx
  ON public.glpi_plugin_integaglpi_message_catalog_audit (event_key, changed_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS glpi_intega_business_hours_singleton_uq
  ON public.glpi_plugin_integaglpi_business_hours ((TRUE));

CREATE INDEX IF NOT EXISTS glpi_intega_msg_auto_cooldown_idx
  ON public.glpi_plugin_integaglpi_message_automation_events (conversation_id, event_key, status, created_at DESC);

CREATE INDEX IF NOT EXISTS glpi_intega_msg_auto_phone_idx
  ON public.glpi_plugin_integaglpi_message_automation_events (phone_e164, event_key, status, created_at DESC)
  WHERE phone_e164 IS NOT NULL;

INSERT INTO public.glpi_plugin_integaglpi_business_hours (
  business_hours_enabled,
  timezone,
  weekday_start_time,
  weekday_end_time,
  saturday_enabled,
  sunday_enabled,
  holiday_behavior,
  outside_hours_event_key,
  cooldown_minutes
)
SELECT FALSE, 'America/Sao_Paulo', '08:00', '18:00', FALSE, FALSE, 'normal', 'outside_business_hours_message', 60
WHERE NOT EXISTS (SELECT 1 FROM public.glpi_plugin_integaglpi_business_hours);

INSERT INTO public.glpi_plugin_integaglpi_message_catalog (
  event_key,
  description,
  group_name,
  default_text,
  send_type,
  expects_response
)
VALUES
  ('welcome_message', 'Mensagem inicial do atendimento', 'Boas-vindas e Fila', 'Olá! Como podemos ajudar?', 'text', TRUE),
  ('queue_selection_prompt', 'Solicita escolha de fila', 'Boas-vindas e Fila', 'Escolha uma das opções de atendimento.', 'interactive_buttons', TRUE),
  ('invalid_queue_selection', 'Opção de fila inválida', 'Boas-vindas e Fila', 'Por favor, responda com uma opção válida do menu.', 'text', TRUE),
  ('profile_name_prompt', 'Solicita nome', 'Coleta de Perfil', 'Por favor, informe seu nome.', 'text', TRUE),
  ('profile_company_prompt', 'Solicita empresa', 'Coleta de Perfil', 'Por favor, informe a empresa.', 'text', TRUE),
  ('profile_email_prompt', 'Solicita e-mail', 'Coleta de Perfil', 'Se tiver, informe seu e-mail para cadastro.', 'text', TRUE),
  ('profile_equipment_prompt', 'Solicita equipamento', 'Coleta de Perfil', 'Informe o equipamento ou sistema afetado.', 'text', TRUE),
  ('profile_reason_prompt', 'Solicita motivo', 'Coleta de Perfil', 'Descreva resumidamente o problema.', 'text', TRUE),
  ('profile_confirmation_prompt', 'Confirma dados coletados', 'Coleta de Perfil', 'Confirma as informações para abrir o chamado?', 'interactive_buttons', TRUE),
  ('profile_confirmed_message', 'Perfil confirmado', 'Coleta de Perfil', 'Dados registrados. Vamos abrir seu chamado.', 'text', FALSE),
  ('awaiting_entity_message', 'Aguardando seleção de entidade', 'Ticket e Solução', 'Recebemos as suas informações, em breve um técnico seguirá com o atendimento.', 'text', FALSE),
  ('ticket_created_message', 'Chamado criado', 'Ticket e Solução', 'Seu chamado #{ticket_id} foi aberto.', 'text', FALSE),
  ('ticket_updated_message', 'Chamado atualizado', 'Ticket e Solução', 'Atualizamos seu chamado com a nova mensagem.', 'text', FALSE),
  ('technician_transfer_message', 'Transferência de técnico', 'Ticket e Solução', 'Seu atendimento foi encaminhado para outro técnico.', 'text', FALSE),
  ('technician_assumed_message', 'Técnico assumiu atendimento', 'Ticket e Solução', 'Um técnico assumiu seu atendimento e seguirá por aqui.', 'text', FALSE),
  ('inactivity_reminder_1', 'Primeiro lembrete de inatividade', 'Avisos e Inatividade', 'Olá! Estamos aguardando seu retorno para continuar o atendimento. Podemos ajudar em algo mais?', 'text', TRUE),
  ('inactivity_reminder_2', 'Segundo lembrete de inatividade', 'Avisos e Inatividade', 'Ainda estamos por aqui. Para seguirmos com o chamado, responda esta mensagem quando puder.', 'text', TRUE),
  ('inactivity_reminder_3', 'Terceiro lembrete de inatividade', 'Avisos e Inatividade', 'Como ainda não tivemos retorno, este atendimento poderá ser encerrado automaticamente se não houver resposta.', 'text', TRUE),
  ('inactivity_autoclose_warning', 'Aviso antes do encerramento', 'Avisos e Inatividade', 'Este atendimento poderá ser encerrado automaticamente se não houver resposta.', 'text', FALSE),
  ('inactivity_autoclose_message', 'Mensagem final de inatividade', 'Avisos e Inatividade', 'Como não tivemos retorno, estamos encerrando este atendimento por falta de resposta. Se precisar, basta nos chamar novamente.', 'text', FALSE),
  ('solution_submitted_message', 'Solução enviada', 'Ticket e Solução', 'Seu chamado foi solucionado. Como você avalia este atendimento?', 'interactive_buttons', TRUE),
  ('solution_approve_reopen_prompt', 'Aprovação ou reabertura', 'Ticket e Solução', 'A solução atendeu sua necessidade?', 'interactive_buttons', TRUE),
  ('solution_approved_message', 'Solução aprovada', 'Ticket e Solução', 'Obrigado pela confirmação.', 'text', FALSE),
  ('solution_reopen_message', 'Solução reaberta', 'Ticket e Solução', 'Vamos reabrir o atendimento para continuidade.', 'text', FALSE),
  ('csat_prompt', 'Pesquisa de satisfação', 'CSAT', 'Como você avalia este atendimento?', 'interactive_buttons', TRUE),
  ('csat_thanks_message', 'Agradecimento CSAT', 'CSAT', 'Obrigado pela avaliação.', 'text', FALSE),
  ('media_received_message', 'Mídia recebida', 'Mídia', 'Recebemos o arquivo enviado e vamos analisá-lo.', 'text', FALSE),
  ('media_processing_failed_message', 'Falha ao processar mídia', 'Mídia', 'Não conseguimos processar o arquivo agora. Um técnico vai verificar.', 'text', FALSE),
  ('outside_24h_template_required_message', 'Janela 24h fechada', 'Avisos e Inatividade', 'A janela de 24h está fechada. Use um template aprovado para iniciar contato.', 'internal_only', FALSE),
  ('outside_business_hours_message', 'Mensagem fora do horário', 'Horário Comercial', 'Olá! Nosso horário de atendimento é de segunda a sexta, das 08h às 18h. Recebemos sua mensagem e retornaremos em breve.', 'text', FALSE),
  ('outside_business_hours_template_missing', 'Template ausente fora da janela', 'Horário Comercial', 'Mensagem fora do horário não enviada: janela 24h fechada e template local ausente.', 'internal_only', FALSE),
  ('outside_business_hours_cooldown_skipped', 'Cooldown fora do horário', 'Horário Comercial', 'Mensagem fora do horário suprimida por cooldown.', 'internal_only', FALSE),
  ('outside_business_hours_sent', 'Fora do horário enviado', 'Horário Comercial', 'Mensagem fora do horário enviada.', 'internal_only', FALSE),
  ('outside_business_hours_failed', 'Falha fora do horário', 'Horário Comercial', 'Falha ao enviar mensagem fora do horário.', 'internal_only', FALSE)
ON CONFLICT (event_key) DO NOTHING;
