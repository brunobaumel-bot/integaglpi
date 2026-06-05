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

  function maybeDecodeJson(value) {
    if (value && typeof value === 'object') { return value; }
    var text = String(value == null ? '' : value).trim();
    if (!text) { return ''; }
    text = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
    try {
      var parsed = JSON.parse(text);
      if (parsed && typeof parsed === 'object') { return parsed; }
    } catch (e) {
      var match = text.match(/\{[\s\S]*\}/);
      if (match) {
        try {
          var innerParsed = JSON.parse(match[0]);
          if (innerParsed && typeof innerParsed === 'object') { return innerParsed; }
        } catch (ignored) {
          // Keep text fallback.
        }
      }
    }
    return text;
  }

  function viewText(value) {
    if (value == null) { return ''; }
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      var scalarText = String(value).replace(/\s+/g, ' ').trim();
      return scalarText === '[object Object]' ? '' : scalarText;
    }
    if (Array.isArray(value)) {
      return value.map(viewText).filter(Boolean).join('; ');
    }
    if (typeof value === 'object') {
      return Object.keys(value).map(function (key) {
        var text = viewText(value[key]);
        return text ? key + ': ' + text : '';
      }).filter(Boolean).join('; ');
    }
    return '';
  }

  function viewList(value) {
    if (Array.isArray(value)) {
      return value.map(viewText).filter(Boolean);
    }
    var text = viewText(value);
    return text ? [text] : [];
  }

  function firstText(record, keys) {
    for (var i = 0; i < keys.length; i += 1) {
      if (record && Object.prototype.hasOwnProperty.call(record, keys[i])) {
        var text = viewText(record[keys[i]]);
        if (text) { return text; }
      }
    }
    return '';
  }

  function firstList(record, keys) {
    for (var i = 0; i < keys.length; i += 1) {
      if (record && Object.prototype.hasOwnProperty.call(record, keys[i])) {
        var list = viewList(record[keys[i]]);
        if (list.length) { return list; }
      }
    }
    return [];
  }

  function normalizeExternalHelpViewModel(result) {
    result = result || {};
    var existing = result.external_help_view_model || result.externalHelpViewModel || null;
    if (existing && typeof existing === 'object') {
      var nested = maybeDecodeJson(existing.diagnostic_hypothesis || existing.diagnosticHypothesis || '');
      var nestedRecord = nested && typeof nested === 'object' && !Array.isArray(nested) ? nested : {};
      var referencesFromExisting = viewList(existing.references || []);
      var referencesFromNested = firstList(nestedRecord, ['fontes_links_sugeridas', 'references', 'fontes', 'sources']);
      var references = referencesFromExisting.length ? referencesFromExisting : referencesFromNested;
      var questions = viewList(existing.customer_questions || existing.customerQuestions || []);
      var steps = viewList(existing.technical_steps || existing.technicalSteps || []);
      var commands = viewList(existing.commands_or_checks || existing.commandsOrChecks || []);
      var cautions = viewList(existing.cautions || []);
      if (!questions.length) { questions = firstList(nestedRecord, ['perguntas_ao_cliente', 'customer_questions', 'confirmationQuestions', 'questions']); }
      if (!steps.length) { steps = firstList(nestedRecord, ['passos_tecnicos', 'technical_steps', 'steps', 'procedimento']); }
      if (!commands.length) { commands = firstList(nestedRecord, ['commands_or_checks', 'commands', 'comandos_verificacoes', 'verificacoes', 'checks']); }
      if (!cautions.length) { cautions = firstList(nestedRecord, ['riscos_cuidados', 'cautions', 'risks', 'cuidados']); }
      var confidence = viewText(existing.confidence_label || existing.confidenceLabel || '');
      if (!confidence) { confidence = references.length ? 'media' : 'baixa'; }
      if (!references.length && confidence.toLowerCase() === 'alta') { confidence = 'baixa'; }
      return {
        status: viewText(existing.status || result.status || 'completed'),
        title: viewText(existing.title || 'Ajuda externa por IA — sugestão, revise antes de aplicar'),
        diagnostic_hypothesis: firstText(nestedRecord, ['diagnostico_provavel', 'diagnostic_hypothesis', 'diagnosis', 'diagnostico'])
          || viewText(existing.diagnostic_hypothesis || existing.diagnosticHypothesis || ''),
        customer_questions: questions,
        technical_steps: steps,
        commands_or_checks: commands,
        cautions: cautions,
        references: references,
        confidence_label: confidence,
        source_type: viewText(existing.source_type || existing.sourceType || 'external_ai_no_sources'),
        source_warning: viewText(existing.source_warning || existing.sourceWarning || ''),
        human_review_required: true,
        can_create_kb_candidate: existing.can_create_kb_candidate !== false,
        no_auto_send: true,
        no_auto_publish: true
      };
    }

    var raw = result.answer || result.summary || result.message || result;
    var decoded = maybeDecodeJson(raw);
    var record = decoded && typeof decoded === 'object' && !Array.isArray(decoded) ? decoded : {};
    var freeText = typeof decoded === 'string' ? decoded : '';
    var references = firstList(record, ['fontes_links_sugeridas', 'references', 'fontes', 'sources']);
    var confidence = viewText(result.confidenceLabel || result.confidence_label || record.confidence_label || '');
    if (!confidence) { confidence = references.length ? 'media' : 'baixa'; }
    if (!references.length && confidence.toLowerCase() === 'alta') { confidence = 'baixa'; }

    return {
      status: viewText(result.status || record.status || 'completed'),
      title: 'Ajuda externa por IA — sugestão, revise antes de aplicar',
      diagnostic_hypothesis: firstText(record, ['diagnostico_provavel', 'diagnostic_hypothesis', 'diagnosis', 'diagnostico']) || freeText,
      customer_questions: firstList(record, ['perguntas_ao_cliente', 'customer_questions', 'confirmationQuestions', 'questions']),
      technical_steps: firstList(record, ['passos_tecnicos', 'technical_steps', 'steps', 'procedimento']),
      commands_or_checks: firstList(record, ['commands_or_checks', 'commands', 'comandos_verificacoes', 'verificacoes', 'checks']),
      cautions: firstList(record, ['riscos_cuidados', 'cautions', 'risks', 'cuidados']),
      references: references,
      confidence_label: confidence,
      source_type: references.length ? 'external_ai_with_sources' : 'external_ai_no_sources',
      source_warning: references.length
        ? 'Fonte informada; ainda exige revisão humana.'
        : 'Sem fontes externas verificáveis; use como sugestão técnica.',
      human_review_required: true,
      can_create_kb_candidate: true,
      no_auto_send: true,
      no_auto_publish: true
    };
  }

  function sectionText(title, items) {
    items = viewList(items);
    return items.length ? (title + ':\n- ' + items.join('\n- ')) : '';
  }

  function renderExternalSection(title, items, code) {
    items = viewList(items);
    if (!items.length) { return ''; }
    var body = '<ul class="mb-2">';
    body += items.map(function (item) {
      return '<li>' + (code ? '<code>' + esc(item) + '</code>' : esc(item)) + '</li>';
    }).join('');
    body += '</ul>';
    return '<div class="mt-2"><div class="fw-bold small mb-1">' + esc(title) + '</div>' + body + '</div>';
  }

  function renderExternalHelpCard(panel, result) {
    var vm = normalizeExternalHelpViewModel(result);
    var cloudEl = panel.querySelector('.js-smart-help-cloud');
    var historyId = result && (result.history_id || result.id || (result.history_item && result.history_item.id)) ? String(result.history_id || result.id || result.history_item.id) : '';
    var noSources = !vm.references.length;
    var questionsText = sectionText('Perguntas ao cliente', vm.customer_questions);
    var stepsText = sectionText('Passos técnicos', vm.technical_steps);
    var commandsText = sectionText('Comandos/verificações', vm.commands_or_checks);
    var allText = [
      'Diagnóstico provável: ' + (vm.diagnostic_hypothesis || ''),
      questionsText,
      stepsText,
      commandsText,
      sectionText('Riscos e cuidados', vm.cautions),
      sectionText('Fontes', vm.references),
      'Revisão humana obrigatória. Nada é enviado ao cliente nem altera o chamado automaticamente.'
    ].filter(Boolean).join('\n\n');

    var html = '<div class="border border-primary rounded p-2 mt-1 js-smart-help-external-card">';
    html += '<div class="d-flex flex-wrap justify-content-between align-items-start gap-2 mb-1">';
    html += '<div class="fw-bold text-primary"><i class="ti ti-robot me-1"></i>' + esc(vm.title || 'Ajuda externa por IA — sugestão, revise antes de aplicar') + '</div>';
    html += '<span class="badge ' + (noSources ? 'bg-warning text-dark' : 'bg-info text-dark') + '">' + esc('confiança: ' + (vm.confidence_label || 'baixa')) + '</span>';
    html += '</div>';
    html += '<div class="alert alert-warning py-2 mb-2 small">' + esc('Revisão humana obrigatória. Nada é enviado ao cliente nem altera o chamado automaticamente. A KB não é publicada automaticamente.') + '</div>';
    html += '<div class="fw-bold small mb-1">' + esc('Diagnóstico provável') + '</div>';
    html += '<p class="mb-2">' + esc(vm.diagnostic_hypothesis || 'Resposta externa recebida para revisão humana.') + '</p>';
    html += renderExternalSection('Perguntas ao cliente', vm.customer_questions, false);
    html += renderExternalSection('Passos técnicos', vm.technical_steps, false);
    html += renderExternalSection('Comandos/verificações', vm.commands_or_checks, true);
    html += renderExternalSection('Riscos e cuidados', vm.cautions, false);
    html += renderExternalSection('Fontes', vm.references, false);
    html += '<div class="text-muted small mt-1">' + esc(vm.source_warning || (noSources ? 'Sem fontes externas verificáveis; use como sugestão técnica.' : 'Fonte informada; ainda exige revisão humana.')) + '</div>';
    html += '<div class="d-flex flex-wrap gap-2 mt-2">';
    html += '<button type="button" class="btn btn-sm btn-outline-secondary js-smart-help-copy" data-text="' + esc(questionsText) + '">' + esc('Copiar perguntas') + '</button>';
    html += '<button type="button" class="btn btn-sm btn-outline-secondary js-smart-help-copy" data-text="' + esc(stepsText) + '">' + esc('Copiar passos') + '</button>';
    html += '<button type="button" class="btn btn-sm btn-outline-secondary js-smart-help-copy" data-text="' + esc(commandsText) + '">' + esc('Copiar comandos') + '</button>';
    html += '<button type="button" class="btn btn-sm btn-outline-primary js-smart-help-copy" data-text="' + esc(allText) + '">' + esc('Copiar tudo') + '</button>';
    if (vm.can_create_kb_candidate !== false) {
      html += '<button type="button" class="btn btn-sm btn-outline-success js-smart-help-suggest-kb" data-history-id="' + esc(historyId) + '">' + esc('Gerar candidato KB manual') + '</button>';
    }
    html += '</div>';
    html += '</div>';

    if (cloudEl) { cloudEl.innerHTML = html; }
    return vm;
  }

  function selectedExternalProvider(panel) {
    var select = panel.querySelector('.js-smart-help-provider');
    var value = select ? String(select.value || '') : 'disabled|';
    var parts = value.split('|');
    return {
      provider: parts[0] || 'disabled',
      model: parts.slice(1).join('|') || ''
    };
  }

  function renderExternalProviderCatalog(panel, catalog) {
    var select = panel.querySelector('.js-smart-help-provider');
    if (!select) { return; }
    var providers = catalog && Array.isArray(catalog.providers) ? catalog.providers : [];
    if (!providers.length) {
      providers = [{ provider: 'disabled', model: '', label: 'Manual / sem provider IA', source: 'manual', enabled: true, disabled_reason: '' }];
    }
    var defaultProvider = catalog && catalog.default_provider ? String(catalog.default_provider) : 'disabled';
    var defaultModel = catalog && catalog.default_model ? String(catalog.default_model) : '';
    var html = providers.map(function (item) {
      var provider = String(item.provider || 'disabled');
      var model = String(item.model || '');
      var label = String(item.label || (provider + (model ? ' / ' + model : '')));
      var source = item.source ? ' (' + String(item.source) + ')' : '';
      var disabled = item.enabled === false;
      var selected = provider === defaultProvider && model === defaultModel;
      return '<option value="' + esc(provider + '|' + model) + '"' + (disabled ? ' disabled' : '') + (selected ? ' selected' : '') + '>'
        + esc(label + source + (disabled && item.disabled_reason ? ' — indisponível: ' + item.disabled_reason : ''))
        + '</option>';
    }).join('');
    select.innerHTML = html;
    if (!select.value && select.options.length) {
      select.selectedIndex = 0;
    }
  }

  function externalHistoryCardHtml(item, active) {
    var vm = normalizeExternalHelpViewModel((item && (item.view_model || item.external_help_view_model)) || item || {});
    var id = item && item.id ? String(item.id) : '';
    var provider = item && item.provider ? String(item.provider) : '';
    var model = item && item.model ? String(item.model) : '';
    var createdAt = item && item.created_at ? String(item.created_at) : '';
    var questionsText = sectionText('Perguntas ao cliente', vm.customer_questions);
    var stepsText = sectionText('Passos técnicos', vm.technical_steps);
    var commandsText = sectionText('Comandos/verificações', vm.commands_or_checks);
    var allText = [
      'Diagnóstico provável: ' + (vm.diagnostic_hypothesis || ''),
      questionsText,
      stepsText,
      commandsText,
      sectionText('Riscos e cuidados', vm.cautions),
      sectionText('Fontes', vm.references),
      'Revisão humana obrigatória. Nada é enviado ao cliente nem altera o chamado automaticamente.'
    ].filter(Boolean).join('\n\n');

    var html = '<div class="border rounded p-2 mb-2 js-smart-help-history-card' + (active ? ' border-primary' : '') + '" data-history-id="' + esc(id) + '">';
    html += '<div class="d-flex justify-content-between gap-2 flex-wrap align-items-start">';
    html += '<button type="button" class="btn btn-sm ' + (active ? 'btn-primary' : 'btn-outline-primary') + ' js-smart-help-history-open" data-history-id="' + esc(id) + '">' + esc('Pesquisa #' + id) + '</button>';
    html += '<span class="badge bg-light text-dark border">' + esc((provider || 'provider') + (model ? ' / ' + model : '')) + '</span>';
    html += '</div>';
    html += '<div class="text-muted small mt-1">' + esc(createdAt || 'histórico persistido') + ' · ' + esc('confiança: ' + (item.confidence_label || vm.confidence_label || 'baixa')) + '</div>';
    if (active) {
      html += '<div class="mt-2 fw-bold small">' + esc('Diagnóstico provável') + '</div>';
      html += '<p class="mb-2">' + esc(vm.diagnostic_hypothesis || 'Resposta externa recebida para revisão humana.') + '</p>';
      html += renderExternalSection('Perguntas ao cliente', vm.customer_questions, false);
      html += renderExternalSection('Passos técnicos', vm.technical_steps, false);
      html += renderExternalSection('Comandos/verificações', vm.commands_or_checks, true);
      html += renderExternalSection('Riscos e cuidados', vm.cautions, false);
      html += renderExternalSection('Fontes', vm.references, false);
      html += '<div class="d-flex flex-wrap gap-2 mt-2">';
      html += '<button type="button" class="btn btn-sm btn-outline-secondary js-smart-help-copy" data-text="' + esc(questionsText) + '">' + esc('Copiar perguntas') + '</button>';
      html += '<button type="button" class="btn btn-sm btn-outline-secondary js-smart-help-copy" data-text="' + esc(stepsText) + '">' + esc('Copiar passos') + '</button>';
      html += '<button type="button" class="btn btn-sm btn-outline-secondary js-smart-help-copy" data-text="' + esc(commandsText) + '">' + esc('Copiar comandos') + '</button>';
      html += '<button type="button" class="btn btn-sm btn-outline-primary js-smart-help-copy" data-text="' + esc(allText) + '">' + esc('Copiar tudo') + '</button>';
      html += '<button type="button" class="btn btn-sm btn-outline-success js-smart-help-suggest-kb" data-history-id="' + esc(id) + '">' + esc('Gerar candidato KB manual') + '</button>';
      html += '</div>';
      html += '<div class="alert alert-warning py-1 mt-2 mb-0 small">' + esc('Revisão humana obrigatória; publicação KB é manual.') + '</div>';
    }
    html += '</div>';
    return html;
  }

  function renderExternalHistory(panel, items, activeId) {
    var target = panel.querySelector('.js-smart-help-history');
    if (!target) { return; }
    items = Array.isArray(items) ? items : [];
    if (!items.length) {
      panel.dataset.activeExternalHistoryId = '';
      target.innerHTML = '<div class="alert alert-light border small mb-2">' + esc('Histórico de pesquisas externas vazio.') + '</div>';
      return;
    }
    activeId = activeId ? String(activeId) : String(items[0].id || '');
    panel.dataset.activeExternalHistoryId = activeId;
    var html = '<div class="fw-bold small mb-1">' + esc('Histórico de pesquisas externas') + '</div>';
    html += items.map(function (item) {
      return externalHistoryCardHtml(item, String(item.id || '') === activeId);
    }).join('');
    target.innerHTML = html;

    var active = items.find(function (item) { return String(item.id || '') === activeId; }) || items[0];
    if (active) {
      renderExternalHelpCard(panel, {
        id: active.id,
        history_id: active.id,
        external_help_view_model: active.view_model || active,
        provider: active.provider,
        model: active.model,
        status: active.status
      });
    }
  }

  function loadExternalHistory(panel, activeId) {
    post(panel, 'list_external_history', {
      conversation_id: panel.dataset.conversationId || ''
    }, { refreshCsrfBeforePost: true, quiet: true }).then(function (resp) {
      var result = resp && resp.result ? resp.result : {};
      renderExternalProviderCatalog(panel, result.provider_catalog || {});
      renderExternalHistory(panel, result.history || [], activeId || '');
    }).catch(function () {
      renderExternalProviderCatalog(panel, { providers: [] });
    });
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

  function hashString(value) {
    var hash = 5381;
    var text = String(value || '');
    for (var i = 0; i < text.length; i += 1) {
      hash = ((hash << 5) + hash) + text.charCodeAt(i);
      hash = hash & hash;
    }
    return Math.abs(hash).toString(36);
  }

  var SMART_HELP_CACHE_PREFIX = 'integaglpiSmartHelpViewModel:v3';

  function contextHash(panel) {
    return hashString([
      panel.dataset.ticketId || '0',
      panel.dataset.conversationId || 'none',
      panel.dataset.contextUpdatedAt || 'unknown'
    ].join('|'));
  }

  function flowKey(panel, mode) {
    return [
      SMART_HELP_CACHE_PREFIX,
      panel.dataset.ticketId || '0',
      panel.dataset.conversationId || 'none',
      contextHash(panel),
      mode || 'workflow'
    ].join(':');
  }

  function loadFlow(panel, mode) {
    try {
      var state = JSON.parse(sessionStorage.getItem(flowKey(panel, mode)) || '{}') || {};
      if (
        state.context_hash && state.context_hash !== contextHash(panel)
        || state.ticket_id && String(state.ticket_id) !== String(panel.dataset.ticketId || '0')
        || state.conversation_id && String(state.conversation_id) !== String(panel.dataset.conversationId || 'none')
      ) {
        return {};
      }
      return state;
    } catch (e) {
      return {};
    }
  }

  function saveFlow(panel, state, mode) {
    try {
      state = state || {};
      state.ticket_id = panel.dataset.ticketId || '0';
      state.conversation_id = panel.dataset.conversationId || 'none';
      state.context_hash = contextHash(panel);
      state.mode = mode || 'workflow';
      state.updated_at = new Date().toISOString();
      sessionStorage.setItem(flowKey(panel, mode), JSON.stringify(state));
    } catch (e) {
      // Session state is only a UX hint; failure must not block SmartHelp.
    }
  }

  function clearFlow(panel, mode) {
    try {
      sessionStorage.removeItem(flowKey(panel, mode));
    } catch (e) {
      // Cache cleanup is best-effort.
    }
  }

  function clearDerivedContext(panel) {
    ['.js-smart-help-articles', '.js-smart-help-local-suggestion', '.js-smart-help-cloud'].forEach(function (selector) {
      var el = panel.querySelector(selector);
      if (el) { el.innerHTML = ''; }
    });
    ['local_search', 'external_preview', 'external_result', 'workflow'].forEach(function (mode) {
      clearFlow(panel, mode);
    });
  }

  function currentSummary(panel) {
    var el = panel.querySelector('.js-smart-help-technical-summary');
    return el ? String(el.value || '').trim() : '';
  }

  function setButtonLoading(btn, loadingText, loading) {
    if (!btn) { return; }
    if (loading) {
      var currentText = btn.textContent || '';
      if (!btn.dataset.originalText || currentText !== loadingText) {
        btn.dataset.originalText = currentText;
      }
      btn.disabled = true;
      btn.textContent = loadingText;
      return;
    }
    var fallbackText = btn.classList.contains('js-smart-help-summarize')
      ? 'Resumo do chamado'
      : btn.classList.contains('js-smart-help-local-search')
        ? 'Busca local'
        : btn.classList.contains('js-smart-help-external')
          ? 'Pedir ajuda externa (nuvem)'
          : '';
    btn.disabled = false;
    btn.textContent = (btn.dataset.originalText && btn.dataset.originalText !== loadingText)
      ? btn.dataset.originalText
      : (fallbackText || btn.textContent || '');
  }

  function nextRequestId(panel, mode) {
    var id = [mode || 'request', String(new Date().getTime()), String(Math.random()).slice(2)].join(':');
    panel.dataset.smartHelpActiveRequestId = id;
    panel.dataset.smartHelpActiveRequestMode = mode || 'request';
    return id;
  }

  function isCurrentRequest(panel, requestId) {
    return requestId !== '' && panel.dataset.smartHelpActiveRequestId === requestId;
  }

  function finishRequest(panel, requestId) {
    if (isCurrentRequest(panel, requestId)) {
      delete panel.dataset.smartHelpActiveRequestId;
      delete panel.dataset.smartHelpActiveRequestMode;
    }
  }

  function safeScalar(value, max) {
    var text = viewText(value);
    if (!text) { return ''; }
    max = max || 500;
    return text.length > max ? text.slice(0, max) : text;
  }

  function safeListForStorage(value, maxItems, maxChars) {
    return viewList(value).slice(0, maxItems || 8).map(function (item) {
      return safeScalar(item, maxChars || 500);
    }).filter(Boolean);
  }

  function safeArticleForStorage(article) {
    article = article || {};
    return {
      title: safeScalar(article.title, 180),
      excerpt: safeScalar(article.excerpt, 600),
      category: safeScalar(article.category, 120),
      sourceLabel: safeScalar(article.sourceLabel || article.source_label, 120),
      confidenceReason: safeScalar(article.confidenceReason || article.confidence_reason, 240),
      confidence: Number(article.confidence || 0) || 0,
      kbCandidateId: Number(article.kbCandidateId || article.kb_candidate_id || 0) || 0,
      glpiKnowbaseitemId: Number(article.glpiKnowbaseitemId || article.glpi_knowbaseitem_id || 0) || 0
    };
  }

  function safeSmartHelpViewModel(result) {
    result = result || {};
    var schema = result.schema044Status || result.schema_044_status || {};
    var search = result.kbSearchSource || result.kb_search_source || {};
    var offer = result.cloudOffer || result.cloud_offer || { available: false };
    var localSuggestion = result.localSuggestion || result.local_suggestion || null;
    return {
      technicalSummary: safeScalar(result.technicalSummary || result.technical_summary, 2000),
      schema044Status: { ok: schema.ok === true },
      kbSearchSource: { label: safeScalar(search.label || 'Base de Conhecimento local', 120) },
      relatedArticles: Array.isArray(result.relatedArticles || result.related_articles)
        ? (result.relatedArticles || result.related_articles).slice(0, 5).map(safeArticleForStorage)
        : [],
      checklist: safeListForStorage(result.checklist || [], 8, 240),
      suggestedQuestions: safeListForStorage(result.suggestedQuestions || result.suggested_questions || [], 8, 240),
      localSuggestion: localSuggestion && localSuggestion.unverified ? {
        unverified: true,
        title: safeScalar(localSuggestion.title || 'Sugestão IA local — valide antes de aplicar', 160),
        content: safeScalar(localSuggestion.content || localSuggestion.summary || localSuggestion.text || localSuggestion.answer, 1200)
      } : null,
      cloudOffer: {
        available: offer.available === true,
        reason: safeScalar(offer.reason || '', 240)
      },
      message: safeScalar(result.message || '', 240),
      workflow_step: safeScalar(result.workflow_step || result.workflowStep || '', 80)
    };
  }

  function safeExternalPreviewViewModel(result) {
    result = result || {};
    return {
      sanitized_text: safeScalar(result.cloud_safe_context || result.sanitized_text || result.sanitizedText || '', 2500),
      removed_kinds: safeListForStorage(result.removed_kinds || result.detected_kinds || result.detectedKinds || [], 12, 80),
      safe_for_cloud: result.safe_for_cloud === true || result.safeForCloud === true
    };
  }

  function safeExternalResultViewModel(result, requestId) {
    var vm = normalizeExternalHelpViewModel(result || {});
    return {
      request_id: safeScalar(requestId || result.request_id || result.requestId || '', 120),
      status: safeScalar(vm.status || 'completed', 80),
      title: safeScalar(vm.title || 'Ajuda externa por IA — sugestão, revise antes de aplicar', 180),
      diagnostic_hypothesis: safeScalar(vm.diagnostic_hypothesis || '', 1600),
      customer_questions: safeListForStorage(vm.customer_questions || [], 8, 320),
      technical_steps: safeListForStorage(vm.technical_steps || [], 12, 420),
      commands_or_checks: safeListForStorage(vm.commands_or_checks || [], 10, 320),
      cautions: safeListForStorage(vm.cautions || [], 8, 320),
      references: safeListForStorage(vm.references || [], 8, 420),
      confidence_label: safeScalar(vm.confidence_label || 'baixa', 80),
      source_type: safeScalar(vm.source_type || 'external_ai_no_sources', 120),
      source_warning: safeScalar(vm.source_warning || '', 240),
      human_review_required: true,
      can_create_kb_candidate: vm.can_create_kb_candidate !== false,
      no_auto_send: true,
      no_auto_publish: true
    };
  }

  function renderExternalPreview(panel, preview) {
    preview = safeExternalPreviewViewModel(preview || {});
    var cloudEl = panel.querySelector('.js-smart-help-cloud');
    var msgEl = panel.querySelector('.js-smart-help-message');
    var sanitized = preview.sanitized_text;
    var kinds = preview.removed_kinds;
    var safe = preview.safe_for_cloud === true;
    var kindsBadges = kinds.length
      ? kinds.map(function (k) { return '<span class="badge bg-warning text-dark me-1">' + esc(k) + '</span>'; }).join('')
      : '<span class="text-muted">' + esc('nenhum') + '</span>';

    var html = '<div class="border rounded p-2 mt-1 js-smart-help-external-preview-card">';
    html += '<div class="small text-muted mb-1">' + esc('Contexto técnico para nuvem gerado a partir do resumo local') + '</div>';
    html += safe
      ? '<div class="fw-bold text-success mb-1">' + esc('Contexto técnico pronto para envio') + '</div>'
      : '<div class="fw-bold text-danger mb-1">' + esc('Bloqueado por PII — não será enviado à nuvem') + '</div>';
    html += '<div class="small text-muted mb-1">' + esc('Tipos removidos:') + ' ' + kindsBadges + '</div>';
    html += '<label class="form-label small mb-1">' + esc('Pré-visualização (somente isto poderia ir à nuvem):') + '</label>';
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
    return preview;
  }

  function restoreSmartHelpPanel(panel) {
    var summaryBtn = panel.querySelector('.js-smart-help-summarize');
    var localBtn = panel.querySelector('.js-smart-help-local-search');
    var externalBtn = panel.querySelector('.js-smart-help-external');
    setButtonLoading(summaryBtn, '', false);
    setButtonLoading(localBtn, '', false);
    setButtonLoading(externalBtn, '', false);

    var summaryState = loadFlow(panel, 'summary');
    var localState = loadFlow(panel, 'local_search');
    var previewState = loadFlow(panel, 'external_preview');
    var externalState = loadFlow(panel, 'external_result');
    var restored = false;

    if (summaryState.view_model) {
      renderResult(panel, summaryState.view_model, { skipPersist: true });
      saveFlow(panel, { step: 'summarized' }, 'workflow');
      setStatus(panel, 'resumo restaurado', 'success');
      restored = true;
    }
    if (localState.view_model) {
      renderResult(panel, localState.view_model, { skipPersist: true });
      saveFlow(panel, { step: 'local_searched' }, 'workflow');
      setStatus(panel, 'busca local restaurada', 'success');
      restored = true;
    }
    if (previewState.view_model) {
      renderExternalPreview(panel, previewState.view_model);
      saveFlow(panel, { step: 'cloud_ready' }, 'workflow');
      restored = true;
    }
    if (externalState.view_model) {
      renderExternalHelpCard(panel, { external_help_view_model: externalState.view_model, status: 'completed' });
      saveFlow(panel, { step: 'cloud_ready' }, 'workflow');
      setStatus(panel, 'ajuda externa restaurada', 'success');
      restored = true;
    }
    if (restored) {
      updateGuidedState(panel);
    }
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

  function renderResult(panel, result, options) {
    options = options || {};
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
      var technicalSummary = result.technicalSummary || result.technical_summary || '';
      if (technicalSummary !== '') {
        technicalSummaryEl.value = technicalSummary;
      }
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
      checklistEl.innerHTML = viewList(result.checklist || []).map(function (c) { return '<li>' + esc(c) + '</li>'; }).join('');
    }
    if (questionsEl) {
      questionsEl.innerHTML = viewList(result.suggestedQuestions || result.suggested_questions || []).map(function (q) {
        return '<li class="d-flex justify-content-between align-items-center gap-2 py-1">'
          + '<span>' + esc(q) + '</span>'
          + '<button type="button" class="btn btn-outline-secondary btn-sm js-smart-help-copy" data-text="' + esc(q) + '">' + esc('Copiar') + '</button></li>';
      }).join('');
    }

    var localSuggestion = result.localSuggestion || result.local_suggestion || null;
    if (localSuggestionEl) {
      if (localSuggestion && localSuggestion.unverified) {
        var localSuggestionTitle = viewText(localSuggestion.title || 'Sugestão IA local — valide antes de aplicar')
          || 'Sugestão IA local — valide antes de aplicar';
        var localSuggestionContent = viewText(
          localSuggestion.content
          || localSuggestion.summary
          || localSuggestion.text
          || localSuggestion.answer
          || 'Valide a sugestão antes de responder ao cliente.'
        ) || 'Valide a sugestão antes de responder ao cliente.';
        localSuggestionEl.innerHTML = '<div class="alert alert-warning py-2 mb-0 small">'
          + '<strong>' + esc(localSuggestionTitle) + '</strong><br>'
          + esc(localSuggestionContent)
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
      if (cloudEl && !loadFlow(panel, 'external_result').view_model && !loadFlow(panel, 'external_preview').view_model) {
        cloudEl.innerHTML = '<span class="text-muted">' + esc(offer.reason || '') + '</span>';
      }
    } else {
      if (cloudEl && !loadFlow(panel, 'external_result').view_model && !loadFlow(panel, 'external_preview').view_model) {
        cloudEl.innerHTML = '';
      }
    }
    if (msgEl) {
      msgEl.textContent = result.message || '';
    }
    if (!options.skipPersist) {
      var workflowStep = result.workflow_step || result.workflowStep || '';
      var mode = workflowStep === 'local_searched' ? 'local_search' : 'summary';
      saveFlow(panel, { step: workflowStep || (mode === 'local_search' ? 'local_searched' : 'summarized'), view_model: safeSmartHelpViewModel(result) }, mode);
    }
    updateGuidedState(panel);
  }

  function handleSummarize(panel) {
    var runBtn = panel.querySelector('.js-smart-help-summarize');
    var msgEl = panel.querySelector('.js-smart-help-message');
    var requestId = nextRequestId(panel, 'summary');
    setButtonLoading(runBtn, 'Gerando resumo...', true);
    if (msgEl) {
      msgEl.textContent = 'Gerando resumo com IA local...';
      msgEl.className = 'mt-2 small js-smart-help-message text-muted';
    }
    setStatus(panel, 'resumo em andamento', 'info');
    post(panel, 'summarize_ticket', { ai_summary: '1' }, { refreshCsrfBeforePost: true }).then(function (resp) {
      if (!isCurrentRequest(panel, requestId)) { return; }
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
        saveFlow(panel, { step: 'summarized', view_model: safeSmartHelpViewModel(r) }, 'summary');
        saveFlow(panel, { step: 'summarized' }, 'workflow');
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
      if (!isCurrentRequest(panel, requestId)) { return; }
      setStatus(panel, 'erro', 'danger');
      renderResult(panel, { message: (error && error.message) ? error.message : 'Não foi possível consultar a Ajuda Inteligente. Revise permissões, schema 044 e configuração local.' });
    }).finally(function () {
      if (isCurrentRequest(panel, requestId)) {
        setButtonLoading(runBtn, '', false);
        finishRequest(panel, requestId);
        updateGuidedState(panel);
      }
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
    var requestId = nextRequestId(panel, 'local_search');
    setButtonLoading(searchBtn, 'Buscando localmente...', true);
    setStatus(panel, 'busca local', 'info');
    post(panel, 'local_search', { technical_summary: summary }, { refreshCsrfBeforePost: true }).then(function (resp) {
      if (!isCurrentRequest(panel, requestId)) { return; }
      var r = resp && resp.result ? resp.result : null;
      if (r) {
        renderResult(panel, r);
        saveFlow(panel, { step: 'local_searched', view_model: safeSmartHelpViewModel(r) }, 'local_search');
        saveFlow(panel, { step: 'local_searched' }, 'workflow');
        setStatus(panel, r.localResolved ? 'KB local encontrada' : 'sugestão local', r.localResolved ? 'success' : 'warning');
      } else {
        setStatus(panel, 'erro', 'danger');
        renderResult(panel, { message: (resp && resp.message) ? resp.message : 'Não foi possível executar a busca local.' });
      }
    }).catch(function (error) {
      if (!isCurrentRequest(panel, requestId)) { return; }
      setStatus(panel, 'erro', 'danger');
      renderResult(panel, { message: (error && error.message) ? error.message : 'Não foi possível executar a busca local.' });
    }).finally(function () {
      if (isCurrentRequest(panel, requestId)) {
        setButtonLoading(searchBtn, '', false);
        finishRequest(panel, requestId);
        updateGuidedState(panel);
      }
    });
  }

  // Step 1 of the two-step cloud flow: ask the server for a SANITIZED PREVIEW.
  // No cloud call happens here. The server-side PII Guard sanitizes the context; the
  // operator sees the sanitized text, the detected PII kinds and whether it is safe to
  // send — then confirms the send explicitly. Raw context never leaves the server.
  function handleExternal(panel) {
    var requestId = nextRequestId(panel, 'external_preview');
    setStatus(panel, 'sanitizando contexto', 'info');
    var msgEl = panel.querySelector('.js-smart-help-message');
    post(panel, 'prepare_external_context', { technical_summary: currentSummary(panel) }, { refreshCsrfBeforePost: true }).then(function (resp) {
      if (!isCurrentRequest(panel, requestId)) { return; }
      if (resp && resp.ok === false && resp.error && !resp.result) {
        if (msgEl) { msgEl.textContent = resp.message || 'Pré-visualização indisponível.'; }
        setStatus(panel, resp.error === 'timeout' ? 'tempo esgotado' : 'erro de rede', 'danger');
        return;
      }
      var r = resp && resp.result ? resp.result : {};
      var preview = renderExternalPreview(panel, r);
      saveFlow(panel, { step: 'cloud_ready', view_model: preview }, 'external_preview');
      saveFlow(panel, { step: 'cloud_ready' }, 'workflow');
    }).finally(function () {
      finishRequest(panel, requestId);
    });
  }

  // Step 2: the operator confirmed. Send to the cloud (consent=1). Node re-sanitizes
  // and blocks on PII independently — the provider never receives raw context.
  function handleExternalSend(panel) {
    if (!window.confirm('Enviar o contexto SANITIZADO para a nuvem? Nada do conteúdo bruto do chamado é enviado.')) { return; }
    setStatus(panel, 'pesquisando externamente', 'info');
    var cloudEl = panel.querySelector('.js-smart-help-cloud');
    var msgEl = panel.querySelector('.js-smart-help-message');
    var previewEl = panel.querySelector('.js-smart-help-external-preview');
    var sanitizedContext = previewEl ? String(previewEl.value || '').trim() : '';
    if (sanitizedContext === '') {
      if (msgEl) { msgEl.textContent = 'Gere e revise a pré-visualização sanitizada antes de enviar para ajuda externa.'; }
      setStatus(panel, 'preview necessário', 'warning');
      return;
    }
    var providerSelection = selectedExternalProvider(panel);
    var requestId = nextRequestId(panel, 'external_result');
    post(panel, 'smart_external', {
      consent: '1',
      sanitized_context: sanitizedContext,
      technical_summary: sanitizedContext,
      conversation_id: panel.dataset.conversationId || '',
      ai_provider: providerSelection.provider,
      ai_model: providerSelection.model
    }, { refreshCsrfBeforePost: true }).then(function (resp) {
      if (!isCurrentRequest(panel, requestId)) { return; }
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
        if (cloudEl && !loadFlow(panel, 'external_result').view_model) { cloudEl.innerHTML = ''; }
        if (msgEl) { msgEl.textContent = r.message || 'A pesquisa não retornou orientação técnica utilizável.'; }
        setStatus(panel, 'sem resposta útil', 'warning');
      } else if (r.status === 'blocked_pii') {
        if (msgEl) { msgEl.textContent = 'Bloqueado: o contexto ainda contém dados sensíveis e não foi enviado.'; }
        setStatus(panel, 'PII bloqueado', 'danger');
      } else if (r.ok && (r.external_help_view_model || r.externalHelpViewModel || r.summary || r.answer || r.message)) {
        var cardPayload = r.history_item
          ? { id: r.history_item.id, history_id: r.history_item.id, external_help_view_model: r.history_item.view_model || r.external_help_view_model || r }
          : r;
        var vm = renderExternalHelpCard(panel, cardPayload);
        if (Array.isArray(r.history)) {
          renderExternalHistory(panel, r.history, r.history_item && r.history_item.id ? String(r.history_item.id) : '');
        } else if (r.history_item) {
          renderExternalHistory(panel, [r.history_item], String(r.history_item.id || ''));
        }
        saveFlow(panel, { step: 'cloud_ready', request_id: requestId, view_model: safeExternalResultViewModel({ external_help_view_model: vm }, requestId) }, 'external_result');
        saveFlow(panel, { step: 'cloud_ready' }, 'workflow');
        if (msgEl) { msgEl.textContent = 'Ajuda externa retornou uma sugestão para revisão humana.'; }
        setStatus(panel, vm.references.length ? 'sugestão IA + fontes' : 'sugestão IA externa', 'success');
      } else {
        if (msgEl) { msgEl.textContent = r.message || 'Pesquisa externa indisponível.'; }
        setStatus(panel, 'erro', 'danger');
      }
    }).finally(function () {
      finishRequest(panel, requestId);
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

    var historyOpen = t.closest('.js-smart-help-history-open');
    if (historyOpen) {
      event.preventDefault();
      var historyId = historyOpen.getAttribute('data-history-id') || '';
      loadExternalHistory(panel, historyId);
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

    var kbButton = t.closest('.js-smart-help-suggest-kb');
    if (kbButton) {
      var selectedHistoryId = kbButton.getAttribute('data-history-id') || panel.dataset.activeExternalHistoryId || '';
      var action = selectedHistoryId ? 'create_kb_candidate_from_external_history' : 'suggest_kb';
      var payload = selectedHistoryId ? { history_id: selectedHistoryId } : {};
      post(panel, action, payload, { refreshCsrfBeforePost: true }).then(function (resp) {
        var msgEl = panel.querySelector('.js-smart-help-message');
        var r = resp && resp.result ? resp.result : {};
        if (!msgEl) { return; }
        msgEl.textContent = r.ok
          ? ('Candidato KB gerado para revisão manual' + (r.glpi_category_name ? ' em ' + r.glpi_category_name : '') + '.')
          : (r.message || 'Sem conhecimento reutilizável suficiente.');
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
      restoreSmartHelpPanel(p);
      loadExternalHistory(p);
      updateGuidedState(p);
      var summaryEl = p.querySelector('.js-smart-help-technical-summary');
      if (summaryEl) {
        summaryEl.addEventListener('input', function () {
          var state = loadFlow(p);
          clearDerivedContext(p);
          if (currentSummary(p) !== '' && !state.step) {
            saveFlow(p, { step: 'summarized' }, 'summary');
            saveFlow(p, { step: 'summarized' }, 'workflow');
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
