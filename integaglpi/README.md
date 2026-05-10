# GLPI WhatsApp Plugin

Plugin nativo para GLPI 11 com foco operacional multiatendente para conversas WhatsApp associadas a tickets.

## Entregas da Fase 2

- tab `WhatsApp` em `Ticket::class`
- historico de mensagens a partir do PostgreSQL externo em `glpi_plugin_integaglpi_messages`
- estado operacional da conversa a partir de `glpi_plugin_integaglpi_conversation_runtime`
- acoes de assumir atendimento, transferir fila e encerrar conversa
- configuracao administrativa de filas e associacoes de utilizadores/grupos em PostgreSQL externo
- perfil proprio `PluginIntegaglpi` com niveis `Read` e `Update` (com compatibilidade para direito legado `PluginWhatsapp`)
- a aba do ticket exige `Read` e a pagina administrativa exige `Update`

## Limites desta fase

- o plugin nao altera o core do GLPI
- o plugin nao chama a API da Meta
- o plugin depende das tabelas operacionais do projeto com prefixo `glpi_plugin_integaglpi_`
- a configuracao da ligacao PDO externa fica numa tabela interna minima do plugin

## Fronts principais

- `front/config.form.php`: configuracao da ligacao PostgreSQL externa e administracao de filas
- `front/profile.form.php`: persistencia das permissoes do perfil
- `front/ticket.whatsapp.action.php`: acoes do tab do ticket

## Estrutura preparada para validacao

Consulte [tests/README.md](D:/Integracao%20GLPI%20Whats/integaglpi/tests/README.md:1) para o roteiro de validacao manual recomendado.
