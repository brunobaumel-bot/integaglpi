# Matriz de Permissoes IA V4.1

Escopo: telas e acoes do plugin IntegraGLPI relacionadas a IA. O direito canonico do plugin continua sendo `plugin_integaglpi`; direitos especificos adicionais devem ser tratados como leitura restrita quando existirem.

| Superficie | Perfil esperado | Permissao | Acoes permitidas | Acoes proibidas |
| --- | --- | --- | --- | --- |
| IA Supervisora P1 | Tecnico com acesso ao ticket | Leitura do ticket/plugin | Disparar analise manual, ver resultado | Enviar WhatsApp, alterar ticket, alterar KB |
| Mineracao historica P2 | Admin tecnico | CLI local | Rodar dataset offline sanitizado | Consultar pesado producao, processar midia |
| Candidatos KB P3 | Supervisor/admin | Supervisor read | Revisar, aprovar para uso manual, copiar Markdown | Publicar automatico na KB |
| Dashboard P4 | Supervisor/admin | Dashboard read | Ver metricas agregadas | Ranking punitivo, export bruto |
| Copiloto P5 | Tecnico com acesso ao ticket | Acesso ao ticket/conversa | Gerar rascunho manual, copiar/usar rascunho | Envio automatico, template automatico |
| Risco P6 | Tecnico/supervisor autorizado | Read-only | Ver badge e registrar feedback | Alterar prioridade/status |
| Piloto Cloud P7 | Admin restrito | Admin + DPO + direcao | Teste sintetico controlado | Cloud sem gate, dados sensiveis |
| Coaching P8 | Supervisor/admin | Coaching read | Ver recomendacoes, feedback, descarte | Ranking publico, acao disciplinar automatica |
| Pesquisa externa P9 | Supervisor/admin ou tecnico autorizado | `plugin_integaglpi_external_research` | Preview, pesquisa allowlist, candidato revisavel | Fonte fora da allowlist, publicar KB automatico |

Regras transversais:
- Usuario sem permissao nao deve ver menu nem executar endpoint.
- POST mutavel exige CSRF.
- Visao por tecnico, quando existir, deve ser privada e anti-punitiva.
- Entidade/permissao nativa do GLPI deve ser respeitada para KB e tickets.

