# Validacao Manual - Fase 2B

## Pre-requisitos

- GLPI 11 com PHP 8.2+
- plugin instalado no diretorio tecnico `integaglpi`
- extensao `pdo_pgsql` disponivel no PHP
- PostgreSQL externo acessivel a partir do servidor do GLPI
- tabelas `glpi_plugin_integaglpi_conversations`, `glpi_plugin_integaglpi_messages` e `glpi_plugin_integaglpi_contacts` disponiveis

## Roteiro

1. Instalar e ativar o plugin.
2. Confirmar que o perfil pode receber o direito `PluginIntegaglpi` com `Read` e `Update` (ou o direito legado `PluginWhatsapp`).
3. Configurar a ligacao PostgreSQL externa em `Configuracao > Plugins > WhatsApp`.
4. Criar ao menos uma fila na configuracao do plugin.
5. Associar utilizadores e grupos a essa fila.
6. Abrir um ticket cujo `id` exista em `glpi_plugin_integaglpi_conversations.glpi_ticket_id`.
7. Verificar se o tab `WhatsApp` aparece apenas para perfis com `Read`.
8. Validar se o historico mostra mensagens de `glpi_plugin_integaglpi_messages`.
9. Confirmar que a timeline abre posicionada na ultima mensagem, inclusive apos recarregar a aba.
10. Executar `Assume attendance` com perfil `Update` e confirmar gravacao em `glpi_plugin_integaglpi_conversation_runtime`.
11. Executar `Transfer` e confirmar alteracao da fila em `glpi_plugin_integaglpi_conversation_runtime`.
12. Executar `Close conversation` e confirmar alteracao para `closed` em runtime e em `glpi_plugin_integaglpi_conversations`.
13. Verificar no historico do ticket do GLPI os registos de assumir, transferir e encerrar.

## Observacoes

- perfis sem `Update` devem visualizar o tab, mas nao as acoes operacionais
- se nao houver conversa vinculada, o tab deve informar a ausencia de contexto
- o plugin nao deve gerar qualquer chamada direta para a Meta
- as acoes devem validar o vinculo entre `ticket_id` e `conversation_id` antes de atualizar
