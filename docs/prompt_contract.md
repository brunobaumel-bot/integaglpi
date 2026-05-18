# Prompt Contract — Engineering Workflow

**Version:** 1.1  
**Last Updated:** 2026-05-13  
**Project:** AI-ENGINEER Control Plane  
**Status:** Official

---

## Purpose
Este documento define o padrão oficial de prompts, handoffs, revisões e governança de segurança para todo o ciclo de engenharia assistida por IA do projeto.

## Single Source of Truth
Este arquivo é a **fonte oficial e mais atualizada**.  
As instruções salvas no ChatGPT (globais e por projeto) são cópias cacheadas e devem ser sincronizadas sempre que este arquivo for alterado.

## Required Prompt Structure
Todo prompt deve seguir este formato:
ROLE:
TASK:
PHASE_ID:
MISSION:
CURRENT_STATE:
SCOPE:
ALLOWLIST:
FORBIDDEN:
SAFETY_FLAGS:
INPUTS:
REQUIRED_ACTION:
OUTPUT_SCHEMA:
TESTS:
ACCEPTANCE_CRITERIA:
STOP_CONDITIONS:
RETURN_FORMAT:
text## Core Principles
- **Contrato > prosa**
- **Checklist > opinião**
- **Reutilize módulos existentes** > criar novos arquivos
- **Mudança mínima possível**
- Gates humanos obrigatórios em todas as etapas

## Safety Flags (Default — Nunca Alterar)
- `safe_to_execute_project=False`
- `safe_to_promote=False`
- `dispatch_prohibited=True`
- `promotion_manual_only=True`
- `human_gate_required=True`
- `human_review_required=True`
- `manual_handoff_only=True`
- `auto_apply_allowed=False`
- `auto_commit_allowed=False`
- `auto_deploy_allowed=False`

## Workflow
1. ChatGPT gera prompt para IAs revisoras (Grok / Gemini / DeepSeek)
2. Revisoras analisam e retornam veredito estruturado
3. ChatGPT consolida e gera prompt para Codex / Claude
4. Codex / Claude implementam **somente** dentro da allowlist
5. Cursor audita o diff real e retorna `CLOSE` / `CLOSE_COM_RESSALVAS` / `FIX` / `BLOCK`
6. Commit, deploy e promoção são **sempre manuais**

## No Subphases Unless
Só é permitido criar subfases ou microfases quando houver:
- BLOCK do Cursor
- Falha de teste crítica
- Arquivo proibido alterado
- Workspace contaminado
- Quebra de safety flag
- Risco real de execução indevida
- Contrato da fase descumprido

## Read-Only for Implementers
Este arquivo é **read-only** para Codex, Claude e Cursor.  
Qualquer alteração deve ser realizada exclusivamente via fase documental aprovada.

## Forbidden by Default
É estritamente proibido:
- `git add .` ou `git add -A`
- Commit, push ou deploy automático
- Alteração de `.env`, banco de dados real ou `.runtime` (salvo fase explícita)
- Chamada automática de providers / APIs / LLMs
- Execução de subprocess sem allowlist explícita
- Aplicação de correções em sandbox fora de fase específica
- Criação de novos arquivos sem autorização explícita na allowlist
- Alteração de arquivos fora da allowlist

## Reviewer Contract (Grok / Gemini / DeepSeek)
- Analisam risco, escopo, segurança e alinhamento com a missão
- Retornam veredito estruturado (`VERDICT`, `BLOCKERS`, `RISKS`, `REQUIRED_ADJUSTMENTS`)
- **Não implementam código**

## Executor Contract (Codex / Claude)
- Implementam **exclusivamente** o que está definido na `SCOPE` e `ALLOWLIST`
- Priorizam reutilização de código existente
- Devem seguir o princípio de **mudança mínima**

## Auditor Contract (Cursor)
- Audita o diff real (`git diff --name-only` + `git status --short`)
- Retorna veredito com evidência (`arquivo + linha` quando possível)
- Verifica escopo real vs escopo aprovado, safety flags e testes

## Maintenance
Qualquer evolução deste contrato deve ser feita através de fase documental aprovada e commit separado.

---

**End of Document**