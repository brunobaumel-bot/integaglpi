/* IntegraGLPI — Ajuda Inteligente (ticket-side panel).
 * Read-only assist: local-KB-first, cloud only on explicit click, sanitized
 * server-side. Never mutates the ticket, never sends WhatsApp, never publishes.
 */
(function () {
  'use strict';
  if (window.__integaglpiSmartHelpLoaded) { return; }
  window.__integaglpiSmartHelpLoaded = true;

  function esc(value) {
    var d = document.createElement('div');
    d.textContent = String(value == null ? '' : value);
    return d.innerHTML;
  }

  function post(panel, action, extra) {
    var params = new URLSearchParams();
    params.set('whatsapp_action', action);
    params.set('ticket_id', panel.dataset.ticketId || '0');
    params.set('_glpi_csrf_token', panel.dataset.csrf || '');
    if (extra) {
      Object.keys(extra).forEach(function (k) { params.set(k, String(extra[k])); });
    }
    return fetch(panel.dataset.actionUrl, {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json',
        'X-Requested-With': 'XMLHttpRequest'
      },
      body: params.toString()
    }).then(function (r) { return r.json().catch(function () { return { ok: false }; }); });
  }

  function setStatus(panel, text, cls) {
    var el = panel.querySelector('.js-smart-help-status');
    if (el) { el.textContent = text; el.className = 'badge bg-' + (cls || 'secondary') + ' js-smart-help-status'; }
  }

  function renderResult(panel, result) {
    var articlesEl = panel.querySelector('.js-smart-help-articles');
    var checklistEl = panel.querySelector('.js-smart-help-checklist');
    var questionsEl = panel.querySelector('.js-smart-help-questions');
    var cloudEl = panel.querySelector('.js-smart-help-cloud');
    var msgEl = panel.querySelector('.js-smart-help-message');
    var externalBtn = panel.querySelector('.js-smart-help-external');
    var technicalSummaryEl = panel.querySelector('.js-smart-help-technical-summary');
    var schemaStatusEl = panel.querySelector('.js-smart-help-schema-status');

    if (technicalSummaryEl) {
      technicalSummaryEl.value = result.technicalSummary || result.technical_summary || '';
    }
    if (schemaStatusEl) {
      var schema = result.schema044Status || result.schema_044_status || {};
      var search = result.kbSearchSource || result.kb_search_source || {};
      schemaStatusEl.textContent = (search.label || 'Base de Conhecimento local')
        + ' · schema 044: ' + (schema.ok ? 'compatível' : 'pendente de homologação');
    }

    // Articles + feedback buttons.
    var articles = (result.relatedArticles || result.related_articles || []);
    if (articles.length === 0) {
      articlesEl.innerHTML = '<div class="text-muted">' + esc('Nenhum artigo local com alta confiança.') + '</div>';
    } else {
      articlesEl.innerHTML = articles.map(function (a) {
        var kbCandidateId = a.kbCandidateId || a.kb_candidate_id || 0;
        var glpiKnowbaseitemId = a.glpiKnowbaseitemId || a.glpi_knowbaseitem_id || 0;
        var conf = Math.round((a.confidence || 0) * 100);
        var source = a.sourceLabel || a.source_label || (glpiKnowbaseitemId ? 'Base de Conhecimento GLPI' : 'Candidato KB');
        var reason = a.confidenceReason || a.confidence_reason || 'Confiança operacional baseada em correspondência local.';
        return '<div class="border-bottom py-2">'
          + '<div class="d-flex justify-content-between align-items-start gap-2">'
          + '<div><strong>' + esc(a.title) + '</strong>'
          + '<div class="text-muted">' + esc(source) + (a.category ? ' · ' + esc(a.category) : '') + '</div>'
          + '<div>' + esc(a.excerpt || '') + '</div>'
          + '<div class="text-muted">' + esc(reason) + ' · ' + esc('Confiança operacional') + ': ' + conf + '%</div></div>'
          + '<span class="btn-group btn-group-sm" role="group">'
          + '<button type="button" class="btn btn-outline-success js-smart-help-feedback" data-kb-candidate-id="' + esc(kbCandidateId) + '" data-glpi-knowbaseitem-id="' + esc(glpiKnowbaseitemId) + '" data-helpful="1">' + esc('Ajudou') + '</button>'
          + '<button type="button" class="btn btn-outline-danger js-smart-help-feedback" data-kb-candidate-id="' + esc(kbCandidateId) + '" data-glpi-knowbaseitem-id="' + esc(glpiKnowbaseitemId) + '" data-helpful="0">' + esc('Não ajudou') + '</button>'
          + '</span></div></div>';
      }).join('');
    }

    checklistEl.innerHTML = (result.checklist || []).map(function (c) { return '<li>' + esc(c) + '</li>'; }).join('');
    questionsEl.innerHTML = (result.suggestedQuestions || result.suggested_questions || []).map(function (q) {
      return '<li class="d-flex justify-content-between align-items-center gap-2 py-1">'
        + '<span>' + esc(q) + '</span>'
        + '<button type="button" class="btn btn-outline-secondary btn-sm js-smart-help-copy" data-text="' + esc(q) + '">' + esc('Copiar') + '</button></li>';
    }).join('');

    var offer = result.cloudOffer || result.cloud_offer || { available: false };
    if (offer.available) {
      externalBtn.classList.remove('d-none');
      cloudEl.innerHTML = '<span class="text-muted">' + esc(offer.reason || '') + '</span>';
    } else {
      externalBtn.classList.add('d-none');
      cloudEl.innerHTML = '';
    }
    msgEl.textContent = result.message || '';
  }

  function runSmartHelp(panel) {
    setStatus(panel, 'analisando', 'info');
    post(panel, 'smart_help').then(function (resp) {
      var r = resp && resp.result ? resp.result : null;
      if (r) {
        renderResult(panel, r);
        if (r.degraded) {
          setStatus(panel, 'modo local (IA indisponível)', 'warning');
        } else {
          setStatus(panel, r.localResolved ? 'KB local encontrada' : 'sem KB local', r.localResolved ? 'success' : 'info');
        }
      } else {
        // Local-first never returns a raw error; this is a transport-only fallback.
        setStatus(panel, 'modo local', 'warning');
        renderResult(panel, { message: 'Não foi possível contatar o serviço. Consulte a base de conhecimento manualmente.' });
      }
    }).catch(function () {
      setStatus(panel, 'modo local', 'warning');
      renderResult(panel, { message: 'Não foi possível contatar o serviço. Consulte a base de conhecimento manualmente.' });
    });
  }

  function handleExternal(panel) {
    if (!window.confirm('A pesquisa externa só deve ser usada quando a KB local não resolver. O contexto passa pelo PII Guard e será enviado SANITIZADO para a nuvem. Confirmar?')) { return; }
    setStatus(panel, 'pesquisando externamente', 'info');
    post(panel, 'smart_external', { consent: '1' }).then(function (resp) {
      var msgEl = panel.querySelector('.js-smart-help-message');
      var r = resp && resp.result ? resp.result : {};
      if (r.status === 'provider_unavailable') {
        msgEl.textContent = r.message || 'Pesquisa externa não configurada.';
        setStatus(panel, 'nuvem indisponível', 'secondary');
      } else if (r.status === 'no_actionable_result') {
        // The provider answered but with nothing usable — be honest, no fake candidate.
        panel.querySelector('.js-smart-help-cloud').innerHTML = '';
        msgEl.textContent = r.message || 'A pesquisa não retornou orientação técnica utilizável.';
        setStatus(panel, 'sem resposta útil', 'warning');
      } else if (r.status === 'blocked_pii') {
        msgEl.textContent = 'Bloqueado: o contexto contém dados sensíveis e não foi enviado.';
        setStatus(panel, 'PII bloqueado', 'danger');
      } else if (r.ok && r.answer) {
        var a = r.answer;
        panel.querySelector('.js-smart-help-cloud').innerHTML =
          '<div class="border rounded p-2 mt-1"><strong>Diagnóstico:</strong> ' + esc(a.diagnosis) + '<br>'
          + '<strong>Passos:</strong><ul>' + (a.steps || []).map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') + '</ul>'
          + '<strong>Riscos:</strong> ' + esc((a.risks || []).join('; ')) + '</div>';
        setStatus(panel, 'resposta externa', 'success');
      } else {
        msgEl.textContent = r.message || 'Pesquisa externa indisponível.';
        setStatus(panel, 'erro', 'danger');
      }
    });
  }

  document.addEventListener('click', function (event) {
    var t = event.target;
    if (!t || !t.closest) { return; }
    var panel = t.closest('.integaglpi-smart-help');
    if (!panel) { return; }

    if (t.closest('.js-smart-help-run')) { runSmartHelp(panel); return; }
    if (t.closest('.js-smart-help-external')) { handleExternal(panel); return; }

    var copyBtn = t.closest('.js-smart-help-copy');
    if (copyBtn) {
      var text = copyBtn.getAttribute('data-text') || '';
      if (navigator.clipboard) { navigator.clipboard.writeText(text); }
      copyBtn.textContent = 'Copiado';
      setTimeout(function () { copyBtn.textContent = 'Copiar'; }, 1500);
      return;
    }

    var fb = t.closest('.js-smart-help-feedback');
    if (fb) {
      post(panel, 'kb_feedback', {
        kb_candidate_id: fb.getAttribute('data-kb-candidate-id') || '0',
        glpi_knowbaseitem_id: fb.getAttribute('data-glpi-knowbaseitem-id') || '0',
        helpful: fb.getAttribute('data-helpful') || '0'
      })
        .then(function () { fb.parentNode.innerHTML = '<span class="text-muted small">obrigado</span>'; });
      return;
    }

    if (t.closest('.js-smart-help-suggest-kb')) {
      post(panel, 'suggest_kb').then(function (resp) {
        var msgEl = panel.querySelector('.js-smart-help-message');
        var r = resp && resp.result ? resp.result : {};
        msgEl.textContent = r.ok ? 'Rascunho de KB gerado para revisão manual.' : (r.message || 'Sem conhecimento reutilizável suficiente.');
      });
      return;
    }
  }, false);

  // Proactive auto-load on render (local KB only; no cloud).
  document.addEventListener('DOMContentLoaded', function () {
    var panels = document.querySelectorAll('.integaglpi-smart-help');
    Array.prototype.forEach.call(panels, function (p) { runSmartHelp(p); });
  });
})();
