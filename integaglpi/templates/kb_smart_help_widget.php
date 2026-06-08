<?php

declare(strict_types=1);

/**
 * KB Smart Help Widget — technician-facing UI.
 *
 * Standalone page for technician to query the local KB RAG copilot.
 * Never sends responses to the customer.
 * Never executes commands automatically.
 * Local AI only (Ollama). Cloud AI blocked.
 *
 * Variables injected by the front controller:
 *   @var string      $csrfToken
 *   @var string      $smartHelpUrl    URL of front/kb.smart_help.php
 *   @var string      $kbFeedbackUrl   URL of front/kb.feedback.php (PHP proxy)
 *   @var string      $addNoteUrl      URL of front/kb.add_note.php (private note)
 *   @var int|null    $ticketId        Pre-filled ticket context (optional)
 *   @var string      $ticketTitle     Pre-filled ticket title (optional, sanitized)
 *   @var string      $ticketDesc      Pre-filled ticket description (optional, sanitized)
 *   @var string      $ticketWarning   Controlled warning for invalid ticket context
 *
 * Phase: integaglpi_local_kb_rag_technician_copilot_001
 * Adendo 1: integaglpi_local_kb_rag_technician_copilot_001_adendo_pipeline_qdrant_001
 * Adendo 2: integaglpi_local_kb_rag_model_query_expansion_adendum_001
 */
$csrfToken   = htmlspecialchars($csrfToken ?? '', ENT_QUOTES, 'UTF-8');
$smartHelpUrl= htmlspecialchars($smartHelpUrl ?? '', ENT_QUOTES, 'UTF-8');
$ticketId    = isset($ticketId) && (int) $ticketId > 0 ? (int) $ticketId : null;
$ticketTitle = htmlspecialchars(mb_substr((string) ($ticketTitle ?? ''), 0, 200, 'UTF-8'), ENT_QUOTES, 'UTF-8');
$ticketDesc  = htmlspecialchars(mb_substr((string) ($ticketDesc ?? ''), 0, 600, 'UTF-8'), ENT_QUOTES, 'UTF-8');
$ticketWarning = htmlspecialchars((string) ($ticketWarning ?? ''), ENT_QUOTES, 'UTF-8');
$kbFeedbackUrl = htmlspecialchars($kbFeedbackUrl ?? '', ENT_QUOTES, 'UTF-8');
$addNoteUrl    = htmlspecialchars($addNoteUrl ?? '', ENT_QUOTES, 'UTF-8');
?>

<style>
#intega-kb-rag-widget { font-family: inherit; max-width: 900px; margin: 0 auto 2rem auto; }
#intega-kb-rag-widget .rag-card { background: #fff; border: 1px solid #dde; border-radius: 6px; padding: 1rem 1.25rem; margin-bottom: 1rem; }
#intega-kb-rag-widget .rag-badge { display:inline-block; padding:2px 7px; border-radius:3px; font-size:.78em; font-weight:600; }
#intega-kb-rag-widget .badge-candidate { background:#e7f3ff; color:#2255cc; }
#intega-kb-rag-widget .badge-approved  { background:#e5f5e0; color:#256029; }
#intega-kb-rag-widget .badge-ai        { background:#fff3cd; color:#7a5c00; }
#intega-kb-rag-widget .badge-det       { background:#f1f1f1; color:#555; }
#intega-kb-rag-widget .rag-section h4  { font-size:.92em; font-weight:700; color:#2c5282; margin: .5rem 0 .2rem 0; }
#intega-kb-rag-widget .rag-section ul  { margin:.25rem 0 .5rem 1.2rem; }
#intega-kb-rag-widget .rag-section li  { font-size:.9em; margin-bottom:.15rem; }
#intega-kb-rag-widget .rag-section p   { font-size:.9em; margin:.2rem 0; }
#intega-kb-rag-widget .rag-kbs-used    { font-size:.82em; color:#555; margin-top:.5rem; }
#intega-kb-rag-widget .rag-kbs-used a  { color:#2255cc; text-decoration:none; }
#intega-kb-rag-widget .rag-warn        { background:#fff8e1; border-left:3px solid #f0ad4e; padding:.5rem .75rem; font-size:.85em; border-radius:3px; }
#intega-kb-rag-widget .rag-conf        { font-size:.82em; color:#777; }
#intega-kb-rag-widget .rag-feedback    { margin-top:.75rem; display:flex; gap:.5rem; align-items:center; flex-wrap:wrap; }
#intega-kb-rag-widget .btn-rag         { cursor:pointer; border:none; border-radius:4px; padding:.35rem .8rem; font-size:.85em; }
#intega-kb-rag-widget .btn-primary     { background:#2255cc; color:#fff; }
#intega-kb-rag-widget .btn-success     { background:#28a745; color:#fff; }
#intega-kb-rag-widget .btn-warning     { background:#fd7e14; color:#fff; }
#intega-kb-rag-widget .btn-danger      { background:#dc3545; color:#fff; }
#intega-kb-rag-widget .btn-secondary   { background:#6c757d; color:#fff; }
#intega-kb-rag-widget .btn-outline     { background:#fff; border:1px solid #2255cc; color:#2255cc; }
#intega-kb-rag-widget .btn-private     { background:#4a4a8a; color:#fff; }
#intega-kb-rag-widget .copy-note-area  { width:100%; min-height:120px; font-size:.85em; border:1px solid #ccc; border-radius:4px; padding:.5rem; margin-top:.5rem; resize:vertical; }
#intega-kb-rag-widget #rag-spinner     { display:none; color:#555; font-size:.9em; }
/* Adendo 2 */
#intega-kb-rag-widget .rag-terms       { margin:.4rem 0; display:flex; flex-wrap:wrap; gap:.3rem; align-items:center; }
#intega-kb-rag-widget .rag-term-pill   { background:#f0f0f0; color:#444; border:1px solid #ddd; border-radius:10px; padding:1px 8px; font-size:.75em; }
#intega-kb-rag-widget .rag-score-grid  { display:flex; flex-wrap:wrap; gap:.4rem; margin-top:.4rem; }
#intega-kb-rag-widget .rag-score-card  { background:#fafafa; border:1px solid #dde; border-radius:5px; padding:.35rem .6rem; font-size:.78em; min-width:160px; }
#intega-kb-rag-widget .rag-score-title { font-weight:600; color:#333; margin-bottom:.2rem; }
#intega-kb-rag-widget .rag-score-bar   { height:6px; background:#e0e0e0; border-radius:3px; overflow:hidden; margin:.25rem 0; }
#intega-kb-rag-widget .rag-score-fill  { height:100%; background:#2255cc; border-radius:3px; }
#intega-kb-rag-widget .badge-boost     { background:#d4edda; color:#155724; font-size:.7em; padding:1px 5px; border-radius:3px; margin-left:3px; }
#intega-kb-rag-widget .badge-flag      { font-size:.7em; padding:1px 5px; border-radius:3px; margin-right:2px; }
#intega-kb-rag-widget .badge-flag-on   { background:#e7f3ff; color:#2255cc; }
#intega-kb-rag-widget .badge-flag-off  { background:#f1f1f1; color:#aaa; }
#intega-kb-rag-widget .rag-cmd-warn   { background:#fff3cd; border:1px solid #ffc107; border-radius:4px; padding:.4rem .6rem; font-size:.82em; margin:.25rem 0 .5rem 0; color:#856404; }
</style>

<div id="intega-kb-rag-widget">
    <div class="rag-card">
        <h3 style="margin:0 0 .75rem 0;">🔍 Ajuda Inteligente — Busca na KB Local</h3>
        <p style="font-size:.85em;color:#555;margin:0 0 .75rem 0;">
            Pesquisa na base de conhecimento local (IA local, sem cloud, sem envio ao cliente).
        </p>

        <?php if ($ticketId !== null): ?>
        <div style="font-size:.85em;color:#444;margin-bottom:.5rem;">
            📋 Chamado #<?= $ticketId ?>
            <?php if ($ticketTitle !== ''): ?>— <?= $ticketTitle ?><?php endif; ?>
        </div>
        <?php endif; ?>

        <?php if ($ticketWarning !== ''): ?>
        <div class="rag-warn" style="margin-bottom:.75rem;">
            <?= $ticketWarning ?>
        </div>
        <?php endif; ?>

        <div style="display:flex;gap:.5rem;align-items:flex-start;flex-wrap:wrap;">
            <textarea
                id="rag-query-input"
                rows="3"
                placeholder="Descreva o problema... (ex: micromed não abre, backup falhou, servidor lento)"
                style="flex:1;min-width:220px;padding:.5rem;border:1px solid #ccc;border-radius:4px;font-size:.9em;resize:vertical;"
            ><?= $ticketDesc ?></textarea>
            <div style="display:flex;flex-direction:column;gap:.4rem;">
                <button class="btn-rag btn-primary" id="rag-search-btn" onclick="integaRagSearch()">
                    🔍 Buscar na KB
                </button>
                <?php if ($ticketDesc !== ''): ?>
                <button class="btn-rag btn-outline" style="font-size:.78em;"
                    onclick="document.getElementById('rag-query-input').value=<?= json_encode($ticketTitle . ' ' . $ticketDesc) ?>;">
                    Usar descrição do chamado
                </button>
                <?php endif; ?>
            </div>
        </div>
        <div style="font-size:.78em;color:#888;margin-top:.3rem;">
            <label><input type="range" id="rag-top-k" min="3" max="5" value="5" style="vertical-align:middle;">
            Top KBs: <span id="rag-top-k-val">5</span></label>
        </div>
        <div id="rag-spinner" style="margin-top:.5rem;">⏳ Consultando KB local...</div>
    </div>

    <div id="rag-result-container" style="display:none;"></div>
</div>

<script>
(function () {
    'use strict';

    var CSRF = <?= json_encode($csrfToken) ?>;
    var SMART_HELP_URL = <?= json_encode($smartHelpUrl) ?>;
    var KB_FEEDBACK_URL = <?= json_encode($kbFeedbackUrl) ?>;
    var ADD_NOTE_URL = <?= json_encode($addNoteUrl) ?>;
    var TICKET_ID = <?= json_encode($ticketId) ?>;

    document.getElementById('rag-top-k').addEventListener('input', function () {
        document.getElementById('rag-top-k-val').textContent = this.value;
    });

    function formBody(payload) {
        var body = new URLSearchParams();
        Object.keys(payload).forEach(function (key) {
            if (payload[key] === null || typeof payload[key] === 'undefined') { return; }
            body.append(key, String(payload[key]));
        });
        return body;
    }

    window.integaRagSearch = function () {
        var query = (document.getElementById('rag-query-input').value || '').trim();
        if (!query) { alert('Informe a consulta.'); return; }
        var topK = parseInt(document.getElementById('rag-top-k').value, 10) || 5;

        document.getElementById('rag-spinner').style.display = 'block';
        document.getElementById('rag-search-btn').disabled = true;
        document.getElementById('rag-result-container').style.display = 'none';

        fetch(SMART_HELP_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', 'Accept': 'application/json' },
            body: formBody({
                _glpi_csrf_token: CSRF,
                query: query,
                ticket_id: TICKET_ID,
                top_k: topK
            })
        })
        .then(function (r) { return r.json(); })
        .then(function (data) {
            document.getElementById('rag-spinner').style.display = 'none';
            document.getElementById('rag-search-btn').disabled = false;
            renderResult(data, query);
        })
        .catch(function (e) {
            document.getElementById('rag-spinner').style.display = 'none';
            document.getElementById('rag-search-btn').disabled = false;
            renderError('Erro de comunicação: ' + e.message);
        });
    };

    function renderError(msg) {
        var c = document.getElementById('rag-result-container');
        c.style.display = 'block';
        c.innerHTML = '<div class="rag-card" style="border-left:3px solid #dc3545;">'
            + '<strong>⚠️ Erro:</strong> ' + escH(msg) + '</div>';
    }

    function renderResult(data, query) {
        var c = document.getElementById('rag-result-container');
        c.style.display = 'block';

        if (!data.ok || !data.playbook) {
            renderError(data.message || 'Resposta inválida do serviço.');
            return;
        }

        var pb = data.playbook;
        var kbs = data.kbsUsed || pb.kbs_utilizadas || [];
        var scoreBreakdown = data.kbsScoreBreakdown || [];
        var expandedTerms  = data.expandedTerms || [];
        var source = data.source || 'deterministic_fallback';
        var aiUsed = data.localAiUsed === true;
        var conf = pb.nivel_de_confianca || 0;
        var found = data.kbsFound || 0;

        var html = '<div class="rag-card">';
        html += '<div style="display:flex;align-items:center;gap:.5rem;margin-bottom:.25rem;flex-wrap:wrap;">';
        html += '<strong>Playbook Técnico</strong>';
        html += ' <span class="rag-badge ' + (aiUsed ? 'badge-ai' : 'badge-det') + '">'
            + (aiUsed ? '🤖 IA Local' : '📋 Determinístico') + '</span>';
        html += ' <span class="rag-conf">Confiança: ' + Math.round(conf * 100) + '% · ' + found + ' KBs encontradas</span>';
        html += '</div>';

        // Adendo 2: Expanded terms pills (transparency — shows what was searched)
        if (expandedTerms.length > 0) {
            html += '<div class="rag-terms" style="margin-bottom:.5rem;">';
            html += '<span style="font-size:.76em;color:#888;">Termos buscados:</span>';
            expandedTerms.slice(0, 20).forEach(function (t) {
                html += '<span class="rag-term-pill">' + escH(String(t)) + '</span>';
            });
            html += '</div>';
        }

        // Safety notice
        html += '<div class="rag-warn" style="margin-bottom:.75rem;">⚠️ '
            + 'Esta resposta é para uso interno do técnico. '
            + '<strong>Não enviar ao cliente automaticamente.</strong> '
            + 'Valide os passos antes de executar.</div>';

        // Resumo do incidente (adendo 1)
        if (pb.resumo_do_incidente) {
            html += '<div class="rag-section">';
            html += '<h4>📝 Resumo do Incidente</h4>';
            html += '<p style="background:#f8f9ff;border-left:3px solid #2255cc;padding:.4rem .6rem;border-radius:3px;">'
                + escH(String(pb.resumo_do_incidente)) + '</p>';
            html += '</div>';
        }

        var sections = [
            { key: 'sintomas_identificados', label: '🔴 Sintomas Identificados', type: 'list' },
            { key: 'hipoteses_por_camada', label: '🔬 Hipóteses por Camada', type: 'list' },
            { key: 'causas_possiveis', label: '🔍 Possíveis Causas', type: 'list' },
            { key: 'perguntas_de_triagem', label: '❓ Perguntas de Triagem', type: 'list' },
            // Command safety notice injected before this section
            { key: 'verificacoes_ou_comandos_sugeridos', label: '🛠️ Verificações / Comandos Sugeridos', type: 'list', cmdWarn: true },
            { key: 'resolucao_sugerida', label: '✅ Resolução Sugerida', type: 'list' },
            { key: 'validacao', label: '☑️ Validação', type: 'list' },
            { key: 'escalonamento', label: '📤 Escalonamento', type: 'list' },
            { key: 'riscos_rollback', label: '⚠️ Riscos / Rollback', type: 'list' },
        ];

        sections.forEach(function (s) {
            var val = pb[s.key];
            if (!val || (Array.isArray(val) && val.length === 0)) { return; }
            html += '<div class="rag-section">';
            html += '<h4>' + escH(s.label) + '</h4>';
            // Adendo 2: Command safety notice — explicit warning before command list
            if (s.cmdWarn) {
                html += '<div class="rag-cmd-warn">⚠️ <strong>Atenção:</strong> '
                    + 'Comandos são sugestões apenas. '
                    + '<strong>Execução é manual pelo técnico — nunca automática.</strong> '
                    + 'Sempre verifique impacto antes de executar em produção.</div>';
            }
            if (s.type === 'list' && Array.isArray(val)) {
                html += '<ul>' + val.map(function (v) {
                    return '<li>' + escH(String(v)) + '</li>';
                }).join('') + '</ul>';
            } else {
                html += '<p>' + escH(String(val)) + '</p>';
            }
            html += '</div>';
        });

        // Security warnings
        if (pb.avisos_de_seguranca && pb.avisos_de_seguranca.length) {
            html += '<div class="rag-warn" style="margin-top:.5rem;"><strong>Segurança:</strong><ul style="margin:.25rem 0 0 1rem;">'
                + pb.avisos_de_seguranca.map(function (w) {
                    return '<li style="font-size:.82em;">' + escH(w) + '</li>';
                }).join('') + '</ul></div>';
        }

        // Adendo 2: KBs with score breakdown
        if (scoreBreakdown.length > 0) {
            html += '<div style="margin-top:.75rem;">';
            html += '<strong style="font-size:.85em;">📊 KBs Recuperadas — Ranking</strong>';
            html += '<div class="rag-score-grid" style="margin-top:.4rem;">';
            scoreBreakdown.forEach(function (e) {
                var bd = e.breakdown || {};
                var pct = Math.round((e.totalScore || 0) * 100);
                var boostBadge = bd.contextBoost ? '<span class="badge-boost">+contexto</span>' : '';
                html += '<div class="rag-score-card">';
                html += '<div class="rag-score-title">' + escH(e.title || 'KB#' + e.id) + boostBadge + '</div>';
                html += '<div class="rag-score-bar"><div class="rag-score-fill" style="width:' + pct + '%"></div></div>';
                html += '<div style="font-size:.72em;color:#555;margin-bottom:.2rem;">' + pct + '% relevância</div>';
                html += '<div>';
                var flags = [
                    { key: 'symptomsMatch', label: 'sintomas' },
                    { key: 'aiHintMatch',   label: 'ai_hint' },
                    { key: 'tagsMatch',     label: 'tags' },
                    { key: 'titleMatch',    label: 'título' },
                ];
                flags.forEach(function (f) {
                    var on = bd[f.key] === true;
                    html += '<span class="badge-flag ' + (on ? 'badge-flag-on' : 'badge-flag-off') + '">'
                        + (on ? '✓' : '·') + ' ' + f.label + '</span>';
                });
                html += '</div>';
                html += '</div>';
            });
            html += '</div></div>';
        } else if (kbs.length > 0) {
            // Fallback: simple list when no breakdown available
            html += '<div class="rag-kbs-used" style="margin-top:.75rem;"><strong>KBs utilizadas:</strong> ';
            html += kbs.map(function (k) {
                var scoreStr = k.score ? ' (' + Math.round(k.score * 100) + '%)' : '';
                return '<span class="rag-badge badge-candidate">' + escH(k.title || 'KB#' + k.id) + scoreStr + '</span>';
            }).join(' ');
            html += '</div>';
        }

        // Feedback buttons
        var kbIds = kbs.map(function (k) { return k.id; }).filter(Boolean);
        if (kbIds.length > 0 && KB_FEEDBACK_URL) {
            html += '<div class="rag-feedback" style="margin-top:.75rem;">';
            html += '<span style="font-size:.82em;color:#555;">Esta resposta foi útil?</span>';
            html += ' <button class="btn-rag btn-success" onclick="integaRagFeedback(true,' + JSON.stringify(kbIds) + ')">👍 Útil</button>';
            html += ' <button class="btn-rag btn-warning" onclick="integaRagFeedback(false,' + JSON.stringify(kbIds) + ')">👎 Não útil</button>';
            html += '</div>';
        }

        html += '</div>'; // close rag-card

        // Build plain text for copy / private note
        var noteText = buildNoteText(pb, kbs, aiUsed);
        html += '<div class="rag-card">';
        html += '<strong>📋 Copiar / Adicionar como Nota Interna</strong>';
        html += '<div style="font-size:.8em;color:#666;margin:.25rem 0;">Revise e edite antes de colar ou enviar como nota.</div>';
        html += '<textarea class="copy-note-area" id="rag-note-textarea">' + escH(noteText) + '</textarea>';
        html += '<div style="display:flex;gap:.5rem;margin-top:.5rem;flex-wrap:wrap;align-items:center;">';
        html += '<button class="btn-rag btn-primary" onclick="integaCopyNote()">📋 Copiar texto</button>';
        // Private note button — only when a ticket is in context
        if (TICKET_ID && ADD_NOTE_URL) {
            html += '<button class="btn-rag btn-private" onclick="integaAddPrivateNote()">'
                + '🔒 Adicionar Nota Privada (#' + TICKET_ID + ')</button>';
        }
        html += '<span id="rag-copy-confirm" style="font-size:.82em;color:green;display:none;">✓ Copiado!</span>';
        html += '<span id="rag-note-confirm" style="font-size:.82em;color:#4a4a8a;display:none;">✓ Nota adicionada!</span>';
        html += '</div>';
        html += '</div>';

        c.innerHTML = html;
    }

    window.integaRagFeedback = function (helpful, kbIds) {
        if (!KB_FEEDBACK_URL || !kbIds.length) { return; }
        kbIds.forEach(function (kbId) {
            fetch(KB_FEEDBACK_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', 'Accept': 'application/json' },
                body: formBody({
                    _glpi_csrf_token: CSRF,
                    kb_candidate_id: kbId,
                    ticket_id: TICKET_ID,
                    helpful: helpful,
                    source: 'kb_rag_copilot'
                })
            }).catch(function () { /* feedback failure is non-blocking */ });
        });
        alert(helpful ? '👍 Feedback positivo registrado. Obrigado!' : '👎 Feedback negativo registrado. Obrigado!');
    };

    window.integaCopyNote = function () {
        var textarea = document.getElementById('rag-note-textarea');
        if (!textarea) { return; }
        navigator.clipboard ? navigator.clipboard.writeText(textarea.value) : (function () {
            textarea.select(); document.execCommand('copy');
        })();
        var c = document.getElementById('rag-copy-confirm');
        if (c) { c.style.display = 'inline'; setTimeout(function () { c.style.display = 'none'; }, 2000); }
    };

    /**
     * Adicionar Nota Privada — human click required.
     *
     * Safety contract (enforced by PHP backend too):
     *  - is_private=1 set by kb.add_note.php — NEVER by JS.
     *  - Human confirmation dialog before any POST.
     *  - No auto-trigger: this function is never called automatically.
     *  - Requires TICKET_ID to be set (ticket context).
     */
    window.integaAddPrivateNote = function () {
        if (!ADD_NOTE_URL || !TICKET_ID) {
            alert('⚠️ Nota privada requer um chamado vinculado. Abra esta página a partir de um chamado (?ticket_id=NNN).');
            return;
        }
        var textarea = document.getElementById('rag-note-textarea');
        if (!textarea || !textarea.value.trim()) {
            alert('⚠️ Nenhum texto para adicionar.');
            return;
        }
        // Human confirmation dialog — mandatory before write
        if (!confirm(
            'Adicionar como NOTA PRIVADA no chamado #' + TICKET_ID + '?\n\n'
            + '✔ O técnico revisou e aprovou o conteúdo.\n'
            + '✔ A nota ficará visível apenas para técnicos (is_private=1).\n'
            + '✔ NÃO será enviada ao cliente automaticamente.\n\n'
            + 'Confirmar?'
        )) { return; }

        var btn = document.querySelector('.btn-private');
        if (btn) { btn.disabled = true; btn.textContent = '⏳ Enviando...'; }

        fetch(ADD_NOTE_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', 'Accept': 'application/json' },
            body: formBody({
                _glpi_csrf_token: CSRF,
                ticket_id: TICKET_ID,
                content: textarea.value
            })
        })
        .then(function (r) { return r.json(); })
        .then(function (d) {
            if (btn) { btn.disabled = false; btn.textContent = '🔒 Adicionar Nota Privada (#' + TICKET_ID + ')'; }
            if (d.ok) {
                var nc = document.getElementById('rag-note-confirm');
                if (nc) { nc.style.display = 'inline'; setTimeout(function () { nc.style.display = 'none'; }, 4000); }
                alert('✅ Nota privada adicionada ao chamado #' + TICKET_ID + ' (ID: ' + (d.followup_id || '?') + ').');
            } else {
                alert('⚠️ Erro ao adicionar nota: ' + escH(d.message || 'Falha desconhecida.'));
            }
        })
        .catch(function (e) {
            if (btn) { btn.disabled = false; btn.textContent = '🔒 Adicionar Nota Privada (#' + TICKET_ID + ')'; }
            alert('⚠️ Erro de comunicação: ' + e.message);
        });
    };

    function buildNoteText(pb, kbs, aiUsed) {
        var lines = ['=== PLAYBOOK TÉCNICO (uso interno) ==='];
        if (pb.resumo_do_incidente) {
            lines.push('', '**Resumo do incidente:**', pb.resumo_do_incidente);
        }
        if (pb.sintomas_identificados && pb.sintomas_identificados.length) {
            lines.push('', '**Sintomas:**');
            pb.sintomas_identificados.forEach(function (s) { lines.push('- ' + s); });
        }
        if (pb.hipoteses_por_camada && pb.hipoteses_por_camada.length) {
            lines.push('', '**Hipóteses por camada:**');
            pb.hipoteses_por_camada.forEach(function (s) { lines.push('- ' + s); });
        }
        if (pb.causas_possiveis && pb.causas_possiveis.length) {
            lines.push('', '**Possíveis causas:**');
            pb.causas_possiveis.forEach(function (s) { lines.push('- ' + s); });
        }
        if (pb.perguntas_de_triagem && pb.perguntas_de_triagem.length) {
            lines.push('', '**Triagem (perguntar ao usuário):**');
            pb.perguntas_de_triagem.forEach(function (s) { lines.push('- ' + s); });
        }
        if (pb.verificacoes_ou_comandos_sugeridos && pb.verificacoes_ou_comandos_sugeridos.length) {
            lines.push('', '**Verificações / comandos:**');
            pb.verificacoes_ou_comandos_sugeridos.forEach(function (s) { lines.push('- ' + s); });
        }
        if (pb.resolucao_sugerida && pb.resolucao_sugerida.length) {
            lines.push('', '**Resolução sugerida:**');
            pb.resolucao_sugerida.forEach(function (s, i) { lines.push((i + 1) + '. ' + s); });
        }
        if (pb.validacao && pb.validacao.length) {
            lines.push('', '**Validação:**');
            pb.validacao.forEach(function (s) { lines.push('- ' + s); });
        }
        if (pb.escalonamento && pb.escalonamento.length) {
            lines.push('', '**Escalonamento:**');
            pb.escalonamento.forEach(function (s) { lines.push('- ' + s); });
        }
        if (pb.riscos_rollback && pb.riscos_rollback.length) {
            lines.push('', '**Riscos / Rollback:**');
            pb.riscos_rollback.forEach(function (s) { lines.push('- ' + s); });
        }
        if (kbs.length) {
            lines.push('', '**KBs utilizadas:**');
            kbs.forEach(function (k) { lines.push('- ' + (k.title || 'KB#' + k.id)); });
        }
        lines.push('', '---');
        lines.push('Fonte: KB local' + (aiUsed ? ' + IA local (Ollama)' : ' (playbook determinístico)'));
        lines.push('NOTA: Validar passos antes de executar. Não enviar ao cliente automaticamente.');
        return lines.join('\n');
    }

    function escH(str) {
        return String(str)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }
})();
</script>
