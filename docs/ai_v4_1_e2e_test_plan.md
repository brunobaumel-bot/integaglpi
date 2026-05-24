# Plano E2E IA V4.1

Objetivo: validar o roadmap IA V4.1 em TESTE/HOMOLOGACAO antes de qualquer promocao manual.

Sequencia recomendada:
1. Confirmar baseline WhatsApp/GLPI: inbound cria ticket, outbound manual envia, roteamento funciona e Central abre.
2. P1: executar IA Supervisora manual em ticket de teste com KB nativa visivel; conferir contexto, limites e aviso humano.
3. P2: rodar mineracao em fixture offline sanitizada; conferir que nao consulta GLPI producao nem processa midia.
4. P3: gerar candidatos a partir de run P2; revisar candidato e copiar Markdown sem publicar automaticamente.
5. P4: abrir dashboard com dados vazios e com dados P1/P2/P3; conferir aviso anti-punitivo.
6. P5: gerar rascunho manual; usar rascunho apenas para preencher campo, sem envio automatico.
7. P6: gerar score deterministico; conferir reasons, warnings e feedback humano.
8. P7: com flags default, confirmar cloud/embeddings bloqueados; smoke sintetico apenas se gates estiverem aprovados.
9. P8: abrir coaching, validar recomendacoes agregadas, feedback e descarte.
10. P9: gerar preview anonimizado, confirmar pesquisa allowlist, criar candidato revisavel e copiar Markdown.

Critérios globais:
- Nenhum webhook/inbound/outbound chama IA automaticamente.
- Nenhum teste envia WhatsApp automatico.
- Nenhum teste altera ticket, prioridade, status ou KB nativa.
- Logs e auditoria nao contem PII, segredo ou prompt bruto.

