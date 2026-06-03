/* IntegraGLPI — Ajuda Inteligente (ticket-side panel) — v7-m2-fix4
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

  // Smart Help fetch timeout (ms). Without a timeout, a hung Node/PHP call leaves
  // the run button disabled indefinitely — browser never fires click on a disabled button.
  var SMART_HELP_TIMEOUT_MS = 25000;

  // Detects a recoverable 403. This includes BOTH our typed JSON csrf_failed AND the
  // opaque GLPI middleware 403 HTML page (which r.json() can't parse → invalid_json).
  // Any 403 is treated as a possibly-consumed-token case worth a single token-refresh
  // + retry; the server re-validates, so this is not a bypass.
  function isCsrfFailure(body) {
    if (!body) { return false; }
    if (body.httpStatus !== 403) { return false; }
    return body.error === 'csrf_invalid'
      || body.error_type === 'csrf_failed'
      || body.error === 'invalid_json'   // opaque upstream 403 HTML page
      || true;                           // any 403 → attempt one refresh+retry
  }

  // Pull a fresh, unconsumed CSRF token via GET (GLPI does not CSRF-protect GET).
  // Updates panel.dataset.csrf in place. Resolves regardless of outcome.
  function refreshCsrfToken(panel) {
    if (!panel.dataset.actionUrl) { return Promise.resolve(false); }
    var sep = panel.dataset.actionUrl.indexOf('?') === -1 ? '?' : '&';
    var url = panel.dataset.actionUrl + sep + 'csrf_token=1&_=' + String(new Date().getTime());
    return fetch(url, {
      method: 'GET',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { 'Accept': 'application/json', 'Cache-Control': 'no-store' }
    }).then(function (r) {
      return r.json().catch(function () { return null; });
    }).then(function (body) {
      if (body && typeof body.csrf_token === 'string' && body.csrf_token !== '') {
        panel.dataset.csrf = body.csrf_token;
        return true;
      }
      return false;
    }).catch(function () { return false; });
  }

  // Single POST attempt. Refreshes panel.dataset.csrf from the response so the NEXT
  // call always uses a fresh, unconsumed token (GLPI CSRF tokens are one-time use).
  function postOnce(panel, action, extra) {
    var controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timeoutId = controller
      ? setTimeout(function () { controller.abort(); }, SMART_HELP_TIMEOUT_MS)
      : null;
    function clearTimer() { if (timeoutId !== null) { clearTimeout(timeoutId); timeoutId = null; } }

    var params = new URLSearchParams();
    params.set('whatsapp_action', action);
    params.set('ticket_id', panel.dataset.ticketId || '0');
    // Plugin expects `_glpi_csrf_token`; keep the canonical name.
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
      body: params.toString(),
      signal: controller ? controller.signal : undefined
    }).then(function (r) {
      clearTimer();
      return r.json().catch(function () {
        return {
          ok: false,
          error: 'invalid_json',
          message: 'A resposta do servidor não pôde ser interpretada.'
        };
      }).then(function (body) {
        body = body || {};
        // Refresh the panel token from EVERY response (success or error) so the next
        // POST uses a live token instead of the consumed static data-csrf.
        if (typeof body.csrf_token === 'string' && body.csrf_token !== '') {
          panel.dataset.csrf = body.csrf_token;
        }
        if (!r.ok) {
          body.ok = false;
          body.httpStatus = r.status;
          body.message = body.message || ('Falha HTTP ' + r.status + ' ao consultar a Ajuda Inteligente.');
        }
        return body;
      });
    }).catch(function (err) {
      clearTimer();
      var aborted = err && err.name === 'AbortError';
      // Always resolve so callers' .finally() re-enables the button.
      return {
        ok: false,
        error: aborted ? 'timeout' : 'network_error',
        message: aborted
          ? 'A Ajuda Inteligente não respondeu no prazo (' + (SMART_HELP_TIMEOUT_MS / 1000) + 's). Verifique o serviço e tente novamente.'
          : ('Erro de rede ao consultar a Ajuda Inteligente: ' + (err && err.message ? err.message : 'desconhecido') + '.')
      };
    });
  }

  function post(panel, action, extra) {
    if (!panel.dataset.actionUrl) {
      // Emit a visible error immediately so the panel is never silently inert.
      setStatus(panel, 'configuração pendente', 'warning');
      var missingMsgEl = panel.querySelector('.js-smart-help-message');
      if (missingMsgEl) {
        missingMsgEl.textContent = 'Ajuda Inteligente não iniciou: ação do painel não configurada (data-action-url ausente).';
        missingMsgEl.className = 'mt-2 small js-smart-help-message text-warning';
      }
      return Promise.reject(new Error('Ajuda Inteligente não iniciou: ação do painel não configurada.'));
    }
    // First attempt. On any 403 (typed csrf_failed OR opaque GLPI middleware HTML),
    // fetch a fresh token via GET, then retry exactly once. No bypass: the server
    // re-validates the refreshed token on the retry POST.
    return postOnce(panel, action, extra).then(function (body) {
      if (isCsrfFailure(body)) {
        return refreshCsrfToken(panel).then(function () {
          return postOnce(panel, action, extra);
        });
      }
      return body;
    });
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
      if (articlesEl) {
        articlesEl.innerHTML = '<div class="text-muted">' + esc('Nenhum artigo local com alta confiança.') + '</div>';
      }
    } else if (articlesEl) {
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

    if (checklistEl) {
      checklistEl.innerHTML = (result.checklist || []).map(function (c) { return '<li>' + esc(c) + '</li>'; }).join('');
    }
    if (questionsEl) {
      questionsEl.innerHTML = (result.suggestedQuestions || result.suggested_questions || []).map(function (q) {
        return '<li class="d-flex justify-content-between align-items-center gap-2 py-1">'
          + '<span>' + esc(q) + '</span>'
          + '<button type="button" class="btn btn-outline-secondary btn-sm js-smart-help-copy" data-text="' + esc(q) + '">' + esc('Copiar') + '</button></li>';
      }).join('');
    }

    var offer = result.cloudOffer || result.cloud_offer || { available: false };
    if (offer.available && externalBtn) {
      externalBtn.classList.remove('d-none');
      if (cloudEl) {
        cloudEl.innerHTML = '<span class="text-muted">' + esc(offer.reason || '') + '</span>';
      }
    } else {
      if (externalBtn) {
        externalBtn.classList.add('d-none');
      }
      if (cloudEl) {
        cloudEl.innerHTML = '';
      }
    }
    if (msgEl) {
      msgEl.textContent = result.message || '';
    }
  }

  // userInitiated = true  → clique manual: desabilita botão, restaura no finally.
  // userInitiated = false → auto-run no load: NÃO desabilita (browser não dispara
  //   click em botão disabled; se o auto-run desabilitar durante o fetch o usuário
  //   que clicar no meio da janela de resposta não verá nada).
  function runSmartHelp(panel, userInitiated) {
    var runBtn = panel.querySelector('.js-smart-help-run');
    var msgEl = panel.querySelector('.js-smart-help-message');
    if (runBtn && userInitiated) {
      runBtn.disabled = true;
      runBtn.dataset.originalText = runBtn.dataset.originalText || (runBtn.textContent || '');
      runBtn.textContent = 'Analisando localmente...';
    }
    if (msgEl) {
      msgEl.textContent = 'Analisando localmente...';
      msgEl.className = 'mt-2 small js-smart-help-message text-muted';
    }
    setStatus(panel, 'analisando', 'info');
    // ai_summary=1 ONLY on manual click → backend calls local AI for the summary.
    // Auto-run (userInitiated falsy) omits it → no GPU load on tab load.
    var extra = userInitiated ? { ai_summary: '1' } : undefined;
    post(panel, 'smart_help', extra).then(function (resp) {
      var r = resp && resp.result ? resp.result : null;
      if (r) {
        renderResult(panel, r);
        var summarySource = r.summarySource || r.summary_source || '';
        var summaryErrorType = r.summaryErrorType || r.summary_error_type || '';
        if (summarySource === 'local_ai') {
          setStatus(panel, 'resumo IA local', 'success');
        } else if (userInitiated && summaryErrorType) {
          setStatus(panel, 'resumo local (IA: ' + summaryErrorType + ')', 'warning');
        } else if (r.degraded) {
          setStatus(panel, 'modo local (IA indisponível)', 'warning');
        } else {
          setStatus(panel, r.localResolved ? 'KB local encontrada' : 'sem KB local', r.localResolved ? 'success' : 'info');
        }
      } else {
        // Local-first never returns a raw error; this is a transport-only fallback.
        setStatus(panel, 'erro', 'danger');
        var errorMessage = (resp && resp.message) ? resp.message : 'Não foi possível consultar a Ajuda Inteligente. Revise permissões, schema 044 e configuração local.';
        if (resp && resp.error_type) {
          errorMessage += ' [' + resp.error_type + ']';
        }
        renderResult(panel, { message: errorMessage });
      }
    }).catch(function (error) {
      setStatus(panel, 'erro', 'danger');
      renderResult(panel, { message: (error && error.message) ? error.message : 'Não foi possível consultar a Ajuda Inteligente. Revise permissões, schema 044 e configuração local.' });
    }).finally(function () {
      if (runBtn && userInitiated) {
        runBtn.disabled = false;
        runBtn.textContent = runBtn.dataset.originalText || 'Ajuda Inteligente';
      }
    });
  }

  function handleExternal(panel) {
    if (!window.confirm('A pesquisa externa só deve ser usada quando a KB local não resolver. O contexto passa pelo PII Guard e será enviado SANITIZADO para a nuvem. Confirmar?')) { return; }
    setStatus(panel, 'pesquisando externamente', 'info');
    post(panel, 'smart_external', { consent: '1' }).then(function (resp) {
      var msgEl = panel.querySelector('.js-smart-help-message');
      // Transport-level failure returned by post() (timeout, network error, endpoint missing).
      if (resp && resp.ok === false && resp.error && !resp.result) {
        msgEl.textContent = resp.message || 'Pesquisa externa indisponível.';
        setStatus(panel, resp.error === 'timeout' ? 'tempo esgotado' : 'erro de rede', 'danger');
        return;
      }
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

    if (t.closest('.js-smart-help-run')) {
      event.preventDefault();
      console.warn('[SmartHelp] clique manual — ticket_id=' + (panel.dataset.ticketId || '?') + ' action_url=' + (panel.dataset.actionUrl ? 'ok' : 'AUSENTE'));
      runSmartHelp(panel, true);  // userInitiated = true → desabilita botão
      return;
    }
    if (t.closest('.js-smart-help-external')) { event.preventDefault(); handleExternal(panel); return; }

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
  // userInitiated = false (omitted) → does NOT disable the run button,
  // so any user click during the auto-run fetch still fires normally.
  function initSmartHelpPanels() {
    var panels = document.querySelectorAll('.integaglpi-smart-help');
    Array.prototype.forEach.call(panels, function (p) {
      // Mark panel so smoke tests / browser DevTools can confirm JS is active.
      p.dataset.smartHelpJsReady = '1';
      runSmartHelp(p);  // auto-run, not user-initiated
    });
  }

  document.addEventListener('DOMContentLoaded', initSmartHelpPanels);
  if (document.readyState !== 'loading') {
    initSmartHelpPanels();
  }
})();
