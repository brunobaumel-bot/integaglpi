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
  // opaque GLPI middleware 403 HTML page (which r.json() can't parse -> invalid_json).
  // Any 403 is treated as a possibly-consumed-token case worth a single token-refresh
  // + retry; the server re-validates, so this is not a bypass.
  function isCsrfFailure(body) {
    if (!body) { return false; }
    if (body.httpStatus !== 403) { return false; }
    return body.error === 'csrf_invalid'
      || body.error_type === 'csrf_failed'
      || body.error === 'invalid_json'
      || body.httpStatus === 403; // any 403 -> attempt one refresh+retry for non-SmartHelp helpers.
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

    var token = panel.dataset.csrf || '';
    var params = new URLSearchParams();
    params.set('smart_action', action);
    params.set('ticket_id', panel.dataset.ticketId || '0');
    // Send the SAME fresh token through every channel GLPI core may read:
    //  - `_glpi_csrf_token` (canonical form field, read in classic form-POST mode)
    //  - `csrf_token` (alias normalized server-side before Plugin::isCsrfValid)
    //  - `X-Glpi-Csrf-Token` header (read by GLPI core in AJAX mode, which is
    //    triggered by X-Requested-With). Without this header an AJAX POST is
    //    rejected upstream with the opaque "Acesso negado" 403 before our script.
    // This does NOT weaken CSRF: the server still validates a non-empty token.
    params.set('_glpi_csrf_token', token);
    params.set('csrf_token', token);
    if (extra) {
      Object.keys(extra).forEach(function (k) { params.set(k, String(extra[k])); });
    }
    return fetch(panel.dataset.actionUrl, {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json',
        'X-Requested-With': 'XMLHttpRequest',
        'X-Glpi-Csrf-Token': token
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

  function post(panel, action, extra, options) {
    options = options || {};
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
    if (options.refreshCsrfBeforePost) {
      return refreshCsrfToken(panel).then(function (refreshed) {
        if (!refreshed) {
          return {
            ok: false,
            error: 'csrf_preflight_failed',
            error_type: 'csrf_failed',
            message: 'Não foi possível obter um token de segurança fresco antes da Ajuda Inteligente. Recarregue a aba e tente novamente.'
          };
        }
        return postOnce(panel, action, extra).then(function (body) {
          if (body && body.httpStatus === 403 && !body.error_type) {
            body.error_type = 'csrf_failed';
            body.message = body.message || 'Acesso negado pelo GLPI após renovar o token de segurança.';
          }
          return body;
        });
      });
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

  function flowKey(panel) {
    return 'integaglpiSmartHelpWorkflow:' + (panel.dataset.ticketId || '0');
  }

  function loadFlow(panel) {
    try {
      return JSON.parse(sessionStorage.getItem(flowKey(panel)) || '{}') || {};
    } catch (e) {
      return {};
    }
  }

  function saveFlow(panel, state) {
    try {
      sessionStorage.setItem(flowKey(panel), JSON.stringify(state || {}));
    } catch (e) {
      // Session state is only a UX hint; failure must not block SmartHelp.
    }
  }

  function currentSummary(panel) {
    var el = panel.querySelector('.js-smart-help-technical-summary');
    return el ? String(el.value || '').trim() : '';
  }

  function setButtonLoading(btn, loadingText, loading) {
    if (!btn) { return; }
    if (loading) {
      btn.dataset.originalText = btn.dataset.originalText || (btn.textContent || '');
      btn.disabled = true;
      btn.textContent = loadingText;
      return;
    }
    btn.disabled = false;
    btn.textContent = btn.dataset.originalText || btn.textContent || '';
  }

  function updateGuidedState(panel) {
    var state = loadFlow(panel);
    var summary = currentSummary(panel);
    var localBtn = panel.querySelector('.js-smart-help-local-search');
    var externalBtn = panel.querySelector('.js-smart-help-external');
    var hasSummary = summary !== '' || state.step === 'summarized' || state.step === 'local_searched' || state.step === 'cloud_ready';
    var localSearched = state.step === 'local_searched' || state.step === 'cloud_ready';
    var cloudOffered = externalBtn && externalBtn.dataset.cloudOffer === '1';

    if (localBtn) {
      localBtn.disabled = !hasSummary;
    }
    if (externalBtn) {
      externalBtn.classList.remove('d-none');
      externalBtn.disabled = !(localSearched && cloudOffered);
      externalBtn.title = externalBtn.disabled
        ? 'Execute a busca local antes de pedir ajuda externa.'
        : 'Executar preview sanitizado antes de enviar à nuvem.';
    }
  }

  function renderResult(panel, result) {
    var articlesEl = panel.querySelector('.js-smart-help-articles');
    var checklistEl = panel.querySelector('.js-smart-help-checklist');
    var questionsEl = panel.querySelector('.js-smart-help-questions');
    var cloudEl = panel.querySelector('.js-smart-help-cloud');
    var msgEl = panel.querySelector('.js-smart-help-message');
    var externalBtn = panel.querySelector('.js-smart-help-external');
    var localSuggestionEl = panel.querySelector('.js-smart-help-local-suggestion');
    var technicalSummaryEl = panel.querySelector('.js-smart-help-technical-summary');
    var schemaStatusEl = panel.querySelector('.js-smart-help-schema-status');
    var schema = result.schema044Status || result.schema_044_status || {};
    var feedbackEnabled = !!schema.ok;

    if (technicalSummaryEl) {
      technicalSummaryEl.value = result.technicalSummary || result.technical_summary || '';
    }
    if (schemaStatusEl) {
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
        var feedbackButtons = feedbackEnabled
          ? '<span class="btn-group btn-group-sm" role="group">'
              + '<button type="button" class="btn btn-outline-success js-smart-help-feedback" data-kb-candidate-id="' + esc(kbCandidateId) + '" data-glpi-knowbaseitem-id="' + esc(glpiKnowbaseitemId) + '" data-helpful="1">' + esc('Ajudou') + '</button>'
              + '<button type="button" class="btn btn-outline-danger js-smart-help-feedback" data-kb-candidate-id="' + esc(kbCandidateId) + '" data-glpi-knowbaseitem-id="' + esc(glpiKnowbaseitemId) + '" data-helpful="0">' + esc('Não ajudou') + '</button>'
              + '</span>'
          : '<span class="text-muted small js-smart-help-feedback-unavailable">' + esc('Feedback indisponível: schema 044 pendente de homologação.') + '</span>';
        return '<div class="border-bottom py-2">'
          + '<div class="d-flex justify-content-between align-items-start gap-2">'
          + '<div><strong>' + esc(a.title) + '</strong>'
          + '<div class="text-muted">' + esc(source) + (a.category ? ' · ' + esc(a.category) : '') + '</div>'
          + '<div>' + esc(a.excerpt || '') + '</div>'
          + '<div class="text-muted">' + esc(reason) + ' · ' + esc('Confiança operacional') + ': ' + conf + '%</div></div>'
          + feedbackButtons + '</div></div>';
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

    var localSuggestion = result.localSuggestion || result.local_suggestion || null;
    if (localSuggestionEl) {
      if (localSuggestion && localSuggestion.unverified) {
        localSuggestionEl.innerHTML = '<div class="alert alert-warning py-2 mb-0 small">'
          + '<strong>' + esc(localSuggestion.title || 'Sugestão IA local — valide antes de aplicar') + '</strong><br>'
          + esc(localSuggestion.content || 'Valide a sugestão antes de responder ao cliente.')
          + '</div>';
      } else {
        localSuggestionEl.innerHTML = '';
      }
    }

    var offer = result.cloudOffer || result.cloud_offer || { available: false };
    if (externalBtn) {
      externalBtn.dataset.cloudOffer = offer.available ? '1' : '0';
      externalBtn.classList.remove('d-none');
    }
    if (offer.available) {
      if (cloudEl) {
        cloudEl.innerHTML = '<span class="text-muted">' + esc(offer.reason || '') + '</span>';
      }
    } else {
      if (cloudEl) {
        cloudEl.innerHTML = '';
      }
    }
    if (msgEl) {
      msgEl.textContent = result.message || '';
    }
    updateGuidedState(panel);
  }

  function handleSummarize(panel) {
    var runBtn = panel.querySelector('.js-smart-help-summarize');
    var msgEl = panel.querySelector('.js-smart-help-message');
    setButtonLoading(runBtn, 'Gerando resumo...', true);
    if (msgEl) {
      msgEl.textContent = 'Gerando resumo com IA local...';
      msgEl.className = 'mt-2 small js-smart-help-message text-muted';
    }
    setStatus(panel, 'resumo em andamento', 'info');
    post(panel, 'summarize_ticket', { ai_summary: '1' }, { refreshCsrfBeforePost: true }).then(function (resp) {
      var r = resp && resp.result ? resp.result : null;
      if (r) {
        renderResult(panel, r);
        var summarySource = r.summarySource || r.summary_source || '';
        var summaryErrorType = r.summaryErrorType || r.summary_error_type || '';
        if (summarySource === 'local_ai') {
          setStatus(panel, 'resumo IA local', 'success');
        } else if (summaryErrorType) {
          setStatus(panel, 'resumo local (IA: ' + summaryErrorType + ')', 'warning');
        } else if (r.degraded) {
          setStatus(panel, 'modo local (IA indisponível)', 'warning');
        } else {
          setStatus(panel, r.localResolved ? 'KB local encontrada' : 'sem KB local', r.localResolved ? 'success' : 'info');
        }
        saveFlow(panel, { step: 'summarized' });
        updateGuidedState(panel);
      } else {
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
      setButtonLoading(runBtn, '', false);
      updateGuidedState(panel);
    });
  }

  function handleLocalSearch(panel) {
    var searchBtn = panel.querySelector('.js-smart-help-local-search');
    var summary = currentSummary(panel);
    if (summary === '') {
      var msgEl = panel.querySelector('.js-smart-help-message');
      if (msgEl) { msgEl.textContent = 'Gere ou preencha o resumo antes da busca local.'; }
      setStatus(panel, 'resumo necessário', 'warning');
      updateGuidedState(panel);
      return;
    }
    setButtonLoading(searchBtn, 'Buscando localmente...', true);
    setStatus(panel, 'busca local', 'info');
    post(panel, 'local_search', { technical_summary: summary }, { refreshCsrfBeforePost: true }).then(function (resp) {
      var r = resp && resp.result ? resp.result : null;
      if (r) {
        renderResult(panel, r);
        saveFlow(panel, { step: 'local_searched' });
        setStatus(panel, r.localResolved ? 'KB local encontrada' : 'sugestão local', r.localResolved ? 'success' : 'warning');
      } else {
        setStatus(panel, 'erro', 'danger');
        renderResult(panel, { message: (resp && resp.message) ? resp.message : 'Não foi possível executar a busca local.' });
      }
    }).catch(function (error) {
      setStatus(panel, 'erro', 'danger');
      renderResult(panel, { message: (error && error.message) ? error.message : 'Não foi possível executar a busca local.' });
    }).finally(function () {
      setButtonLoading(searchBtn, '', false);
      updateGuidedState(panel);
    });
  }

  // Step 1 of the two-step cloud flow: ask the server for a SANITIZED PREVIEW.
  // No cloud call happens here. The server-side PII Guard sanitizes the context; the
  // operator sees the sanitized text, the detected PII kinds and whether it is safe to
  // send — then confirms the send explicitly. Raw context never leaves the server.
  function handleExternal(panel) {
    setStatus(panel, 'sanitizando contexto', 'info');
    var cloudEl = panel.querySelector('.js-smart-help-cloud');
    var msgEl = panel.querySelector('.js-smart-help-message');
    post(panel, 'prepare_external_context', { technical_summary: currentSummary(panel) }, { refreshCsrfBeforePost: true }).then(function (resp) {
      if (resp && resp.ok === false && resp.error && !resp.result) {
        if (msgEl) { msgEl.textContent = resp.message || 'Pré-visualização indisponível.'; }
        setStatus(panel, resp.error === 'timeout' ? 'tempo esgotado' : 'erro de rede', 'danger');
        return;
      }
      var r = resp && resp.result ? resp.result : {};
      var sanitized = r.sanitized_text || r.sanitizedText || '';
      var kinds = r.detected_kinds || r.detectedKinds || [];
      var safe = (r.safe_for_cloud === true) || (r.safeForCloud === true);

      var kindsBadges = kinds.length
        ? kinds.map(function (k) { return '<span class="badge bg-warning text-dark me-1">' + esc(k) + '</span>'; }).join('')
        : '<span class="text-muted">' + esc('nenhum') + '</span>';

      var html = '<div class="border rounded p-2 mt-1">';
      if (safe) {
        html += '<div class="fw-bold text-success mb-1">' + esc('Contexto sanitizado pronto para envio') + '</div>';
      } else {
        html += '<div class="fw-bold text-danger mb-1">' + esc('Bloqueado por PII — não será enviado à nuvem') + '</div>';
      }
      html += '<div class="small text-muted mb-1">' + esc('Tipos detectados/removidos:') + ' ' + kindsBadges + '</div>';
      html += '<label class="form-label small mb-1">' + esc('Pré-visualização sanitizada (somente isto poderia ir à nuvem):') + '</label>';
      html += '<textarea class="form-control form-control-sm js-smart-help-external-preview" rows="4" readonly>' + esc(sanitized) + '</textarea>';
      html += '<div class="d-flex gap-2 mt-2 flex-wrap">';
      if (safe) {
        html += '<button type="button" class="btn btn-sm btn-warning js-smart-help-external-send">'
          + '<i class="ti ti-cloud-upload me-1"></i>' + esc('Confirmar envio sanitizado para a nuvem') + '</button>';
      } else {
        html += '<span class="text-danger small align-self-center">' + esc('Há PII residual: revise o chamado. Envio bloqueado.') + '</span>';
      }
      html += '<button type="button" class="btn btn-sm btn-outline-secondary js-smart-help-copy" data-text="' + esc(sanitized) + '">'
        + esc('Copiar contexto sanitizado') + '</button>';
      html += '</div></div>';

      if (cloudEl) { cloudEl.innerHTML = html; }
      if (msgEl) { msgEl.textContent = ''; }
      setStatus(panel, safe ? 'pronto para envio' : 'PII bloqueado', safe ? 'success' : 'danger');
    });
  }

  // Step 2: the operator confirmed. Send to the cloud (consent=1). Node re-sanitizes
  // and blocks on PII independently — the provider never receives raw context.
  function handleExternalSend(panel) {
    if (!window.confirm('Enviar o contexto SANITIZADO para a nuvem? Nada do conteúdo bruto do chamado é enviado.')) { return; }
    setStatus(panel, 'pesquisando externamente', 'info');
    var cloudEl = panel.querySelector('.js-smart-help-cloud');
    var msgEl = panel.querySelector('.js-smart-help-message');
    post(panel, 'smart_external', { consent: '1', technical_summary: currentSummary(panel) }, { refreshCsrfBeforePost: true }).then(function (resp) {
      if (resp && resp.ok === false && resp.error && !resp.result) {
        if (msgEl) { msgEl.textContent = resp.message || 'Pesquisa externa indisponível.'; }
        setStatus(panel, resp.error === 'timeout' ? 'tempo esgotado' : 'erro de rede', 'danger');
        return;
      }
      var r = resp && resp.result ? resp.result : {};
      if (r.status === 'provider_unavailable') {
        if (msgEl) { msgEl.textContent = r.message || 'Pesquisa externa não configurada.'; }
        setStatus(panel, 'nuvem indisponível', 'secondary');
      } else if (r.status === 'no_actionable_result') {
        if (cloudEl) { cloudEl.innerHTML = ''; }
        if (msgEl) { msgEl.textContent = r.message || 'A pesquisa não retornou orientação técnica utilizável.'; }
        setStatus(panel, 'sem resposta útil', 'warning');
      } else if (r.status === 'blocked_pii') {
        if (msgEl) { msgEl.textContent = 'Bloqueado: o contexto ainda contém dados sensíveis e não foi enviado.'; }
        setStatus(panel, 'PII bloqueado', 'danger');
      } else if (r.ok && r.answer) {
        var a = r.answer;
        if (cloudEl) {
          cloudEl.innerHTML =
            '<div class="border rounded p-2 mt-1"><strong>Diagnóstico:</strong> ' + esc(a.diagnosis) + '<br>'
            + '<strong>Passos:</strong><ul>' + (a.steps || []).map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') + '</ul>'
            + '<strong>Riscos:</strong> ' + esc((a.risks || []).join('; ')) + '</div>';
        }
        setStatus(panel, 'resposta externa', 'success');
      } else {
        if (msgEl) { msgEl.textContent = r.message || 'Pesquisa externa indisponível.'; }
        setStatus(panel, 'erro', 'danger');
      }
    });
  }

  document.addEventListener('click', function (event) {
    var t = event.target;
    if (!t || !t.closest) { return; }
    var panel = t.closest('.integaglpi-smart-help');
    if (!panel) { return; }

    if (t.closest('.js-smart-help-summarize')) {
      event.preventDefault();
      console.warn('[SmartHelp] resumo manual — ticket_id=' + (panel.dataset.ticketId || '?') + ' action_url=' + (panel.dataset.actionUrl ? 'ok' : 'AUSENTE'));
      handleSummarize(panel);
      return;
    }
    if (t.closest('.js-smart-help-local-search')) {
      event.preventDefault();
      handleLocalSearch(panel);
      return;
    }
    if (t.closest('.js-smart-help-external-send')) { event.preventDefault(); handleExternalSend(panel); return; }
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
      fb.disabled = true;
      var originalFeedbackLabel = fb.textContent || '';
      post(panel, 'kb_feedback', {
        kb_candidate_id: fb.getAttribute('data-kb-candidate-id') || '0',
        glpi_knowbaseitem_id: fb.getAttribute('data-glpi-knowbaseitem-id') || '0',
        helpful: fb.getAttribute('data-helpful') || '0'
      })
        .then(function (resp) {
          var result = resp && resp.result ? resp.result : resp;
          if (result && result.ok === true && result.status === 'recorded') {
            fb.parentNode.innerHTML = '<span class="text-muted small">feedback registrado</span>';
            return;
          }

          fb.disabled = false;
          fb.textContent = originalFeedbackLabel;
          var msgEl = panel.querySelector('.js-smart-help-message');
          if (msgEl) {
            msgEl.textContent = (result && result.message)
              ? result.message
              : 'Feedback indisponível: schema 044 pode estar pendente de homologação.';
            msgEl.className = 'mt-2 small js-smart-help-message text-warning';
          }
        })
        .catch(function () {
          fb.disabled = false;
          fb.textContent = originalFeedbackLabel;
          var msgEl = panel.querySelector('.js-smart-help-message');
          if (msgEl) {
            msgEl.textContent = 'Feedback indisponível: schema 044 pode estar pendente de homologação.';
            msgEl.className = 'mt-2 small js-smart-help-message text-warning';
          }
        });
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

  // Do not auto-run SmartHelp on render. GLPI can reject POSTs before this PHP
  // endpoint runs when a stale token is reused, so SmartHelp is manual-only:
  // click -> GET csrf_token=1 -> POST summarize_ticket/local_search.
  function initSmartHelpPanels() {
    var panels = document.querySelectorAll('.integaglpi-smart-help');
    Array.prototype.forEach.call(panels, function (p) {
      // Mark panel so smoke tests / browser DevTools can confirm JS is active.
      p.dataset.smartHelpJsReady = '1';
      updateGuidedState(p);
      var summaryEl = p.querySelector('.js-smart-help-technical-summary');
      if (summaryEl) {
        summaryEl.addEventListener('input', function () {
          var state = loadFlow(p);
          if (currentSummary(p) !== '' && !state.step) {
            saveFlow(p, { step: 'summarized' });
          }
          updateGuidedState(p);
        });
      }
    });
  }

  document.addEventListener('DOMContentLoaded', initSmartHelpPanels);
  if (document.readyState !== 'loading') {
    initSmartHelpPanels();
  }
})();
