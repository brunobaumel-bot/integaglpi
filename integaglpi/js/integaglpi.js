/* global jQuery */
(function () {
  'use strict';

  if (window.__integaglpiScriptLoaded) {
    return;
  }
  window.__integaglpiScriptLoaded = true;

  console.log('[integaglpi] Script initialized with event delegation');

  function log() {
    try { console.log.apply(console, arguments); } catch (e) {}
  }
  function warn() {
    try { console.warn.apply(console, arguments); } catch (e) {}
  }
  function err() {
    try { console.error.apply(console, arguments); } catch (e) {}
  }

  function postUrlEncoded(url, payloadObj) {
    const params = new URLSearchParams();
    Object.keys(payloadObj).forEach((key) => {
      const value = payloadObj[key];
      if (value === undefined || value === null) return;
      params.set(key, String(value));
    });

    return fetch(url, {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json',
        'X-Requested-With': 'XMLHttpRequest'
      },
      body: params.toString()
    });
  }

  function readJsonOrFriendlyError(response) {
    const status = response.status;
    const contentType = response.headers.get('content-type') || '';

    return response.text().then((body) => {
      const trimmed = String(body || '').trimStart();
      if (trimmed.charAt(0) === '<') {
        throw new Error('Resposta inesperada não JSON. Recarregue a página e verifique sua sessão/permissão.');
      }

      let payload = null;
      if (trimmed !== '') {
        try {
          payload = JSON.parse(trimmed);
        } catch (parseError) {
          throw new Error('Resposta inesperada não JSON.');
        }
      }

      if (!response.ok || (payload && payload.success === false)) {
        const message = payload && (payload.message || payload.error)
          ? String(payload.message || payload.error)
          : 'HTTP ' + status;
        throw new Error(message);
      }

      if (contentType.indexOf('application/json') === -1 && payload === null) {
        throw new Error('Resposta inesperada não JSON.');
      }

      return payload || { success: true };
    });
  }

  function findClosest(el, selector) {
    if (!el) return null;
    if (el.closest) return el.closest(selector);
    // IE fallback not needed; GLPI 11 supported browsers have closest.
    return null;
  }

  /**
   * IntegraGLPI owns the six parent sidebar groups end-to-end.
   *
   * Previous approaches kept Bootstrap's data-API toggle installed and tried
   * to fight it with stopImmediatePropagation + reactive listeners on
   * show.bs.dropdown / hidden.bs.dropdown — the result was the visible
   * "abre e fecha" flicker because Bootstrap's internal Dropdown instance
   * kept toggling its own `_isShown` state behind our backs and auto-closing
   * sibling groups.
   *
   * Definitive contract:
   *   1. Dispose every Bootstrap Dropdown instance attached to the 6 toggles
   *      and strip `data-bs-toggle="dropdown"` so Bootstrap never re-binds.
   *   2. Be the sole owner of `.show` / `aria-expanded` / `.active`.
   *   3. Persist open labels in sessionStorage; restore them on DOM ready,
   *      after ajaxComplete and whenever the sidebar is re-rendered (mutation
   *      observer).
   *   4. Never auto-close sibling groups — operator may keep several open.
   *
   * Phase: integaglpi_ops_console_claim_ui_messaging_stabilization_001_FIX_MENU_TOGGLE.
   */
  function initSidebarMenuTreePersistence() {
    const labels = [
      'WhatsApp / Central',
      'Configuração',
      'Monitoramento',
      'IA',
      'Gestão',
      'Supervisão'
    ];
    const labelSet = new Set(labels);
    const storageKey = 'integaglpi.sidebar.openMenuClasses';
    const ownedClass = 'integaglpi-sidebar-owned';

    function normalizeLabel(text) {
      return String(text || '').replace(/\s+/g, ' ').trim();
    }

    function readOpenLabels() {
      try {
        const parsed = JSON.parse(window.sessionStorage.getItem(storageKey) || '[]');
        if (Array.isArray(parsed)) {
          return new Set(parsed.filter((label) => labelSet.has(label)));
        }
      } catch (e) {}
      return new Set();
    }

    function writeOpenLabels(openLabels) {
      try {
        window.sessionStorage.setItem(storageKey, JSON.stringify(Array.from(openLabels)));
      } catch (e) {}
    }

    function getGroupEntries() {
      return Array.prototype.slice.call(document.querySelectorAll('#navbar-menu .nav-item.dropdown'))
        .map((item) => {
          const link = item.querySelector(':scope > .nav-link.dropdown-toggle');
          const labelEl = link ? link.querySelector('.menu-label') : null;
          const label = normalizeLabel(labelEl ? labelEl.textContent : '');
          const menu = item.querySelector(':scope > .dropdown-menu');
          return { item, link, menu, label };
        })
        .filter((entry) => entry.link && entry.menu && labelSet.has(entry.label));
    }

    function setGroupOpen(entry, open) {
      entry.item.classList.toggle('active', open);
      entry.link.classList.toggle('active', open);
      entry.link.classList.toggle('show', open);
      entry.link.setAttribute('aria-expanded', open ? 'true' : 'false');
      entry.menu.classList.toggle('show', open);
      // Strip residual Bootstrap CSS animation classes so restored groups
      // don't flash a transition on every page load.
      entry.menu.classList.remove('animate__fadeInLeft', 'animate__zoomIn');
    }

    /**
     * Detach Bootstrap from this toggle so it never auto-toggles or
     * auto-closes sibling groups. Idempotent — safe to call on every pass.
     */
    function neutralizeBootstrap(entry) {
      if (!entry.link || entry.link.classList.contains(ownedClass)) {
        return;
      }
      entry.link.classList.add(ownedClass);
      try {
        const bs = window.bootstrap;
        if (bs && bs.Dropdown && typeof bs.Dropdown.getInstance === 'function') {
          const instance = bs.Dropdown.getInstance(entry.link);
          if (instance && typeof instance.dispose === 'function') {
            instance.dispose();
          }
        }
      } catch (e) {}
      // Remove every attribute Bootstrap's data-API uses to re-bind.
      entry.link.removeAttribute('data-bs-toggle');
      entry.link.removeAttribute('data-toggle');
      entry.link.removeAttribute('data-bs-auto-close');
    }

    function applyAll() {
      const openLabels = readOpenLabels();
      getGroupEntries().forEach((entry) => {
        neutralizeBootstrap(entry);
        setGroupOpen(entry, openLabels.has(entry.label));
      });
    }

    // Owner click handler. Capture phase + stopImmediatePropagation are kept
    // as defense in depth: if a future GLPI build re-attaches a global
    // listener before our applyAll() runs, this still wins.
    document.addEventListener('click', function (event) {
      const link = event.target && event.target.closest
        ? event.target.closest('#navbar-menu .nav-item.dropdown > .nav-link.dropdown-toggle')
        : null;
      if (!link) return;

      const item = link.closest('.nav-item.dropdown');
      if (!item) return;
      const labelEl = link.querySelector('.menu-label');
      const label = normalizeLabel(labelEl ? labelEl.textContent : '');
      if (!labelSet.has(label)) return;

      event.preventDefault();
      event.stopPropagation();
      if (typeof event.stopImmediatePropagation === 'function') {
        event.stopImmediatePropagation();
      }

      const menu = item.querySelector(':scope > .dropdown-menu');
      const entry = { item, link, menu, label };
      neutralizeBootstrap(entry);

      const openLabels = readOpenLabels();
      const isOpen = openLabels.has(label);
      if (isOpen) {
        openLabels.delete(label);
      } else {
        openLabels.add(label);
      }
      writeOpenLabels(openLabels);
      setGroupOpen(entry, !isOpen);
    }, true);

    // GLPI streams the sidebar; first pass + a few retries cover late renders
    // without depending on a specific event ordering.
    applyAll();
    window.setTimeout(applyAll, 50);
    window.setTimeout(applyAll, 200);
    window.setTimeout(applyAll, 500);

    // Re-apply after any GLPI AJAX cycle that may have re-rendered the sidebar.
    if (typeof jQuery !== 'undefined' && jQuery && jQuery(document) && jQuery(document).on) {
      jQuery(document)
        .off('ajaxComplete.integaglpiSidebar')
        .on('ajaxComplete.integaglpiSidebar', function () {
          applyAll();
        });
    }

    // Re-apply when GLPI swaps the navbar (partial reloads, htmx/pjax, etc).
    if (typeof MutationObserver === 'function') {
      const observer = new MutationObserver((mutations) => {
        for (let i = 0; i < mutations.length; i++) {
          const m = mutations[i];
          if (!m.addedNodes || !m.addedNodes.length) continue;
          for (let j = 0; j < m.addedNodes.length; j++) {
            const node = m.addedNodes[j];
            if (!node || node.nodeType !== 1) continue;
            if (node.id === 'navbar-menu' ||
                (typeof node.querySelector === 'function' && node.querySelector('#navbar-menu'))) {
              applyAll();
              return;
            }
          }
        }
      });
      try {
        observer.observe(document.body, { childList: true, subtree: true });
      } catch (e) {}
    }
  }

  function readQueueEditorPayload(editor) {
    const idEl = editor.querySelector('[data-integaglpi-field="id"]');
    const nameEl = editor.querySelector('[data-integaglpi-field="name"]');
    const descEl = editor.querySelector('[data-integaglpi-field="description"]');
    const groupEl = editor.querySelector('[data-integaglpi-field="default_group_id"]');
    const activeEl = editor.querySelector('[data-integaglpi-field="is_active"]');
    const groupSelect = editor.querySelector('select[name="default_group_id"]');

    const id = idEl ? String(idEl.value || '0') : String(editor.getAttribute('data-queue-id') || '0');
    const name = nameEl ? String(nameEl.value || '') : '';
    const description = descEl ? String(descEl.value || '') : '';
    const defaultGroupId = groupEl
      ? String(groupEl.value || '0')
      : (groupSelect ? String(groupSelect.value || '0') : '0');
    const isActive = activeEl && activeEl.checked ? '1' : '0';

    return {
      save_queue: '1',
      id: id && id !== '0' ? id : '0',
      name,
      description,
      default_group_id: defaultGroupId,
      is_active: isActive
    };
  }

  function handleQueueSaveClick(button) {
    const editor = findClosest(button, '.integaglpi-queue-editor') || document.querySelector('.integaglpi-queue-editor');
    if (!editor) {
      warn('[integaglpi][config] editor not found');
      alert('Editor de fila não encontrado.');
      return;
    }

    const configUrl =
      (button && button.dataset ? button.dataset.configUrl : '') ||
      (editor.dataset ? editor.dataset.configUrl : '') ||
      '';

    if (!configUrl) {
      warn('[integaglpi][config] configUrl empty');
      alert('configUrl vazio. Não é possível enviar.');
      return;
    }

    const payload = readQueueEditorPayload(editor);
    log('[integaglpi] queue save clicked', payload);
    log('[integaglpi] queue payload', payload);

    if (!payload.name || !String(payload.name).trim()) {
      alert('Nome da fila é obrigatório.');
      return;
    }

    button.disabled = true;
    postUrlEncoded(configUrl, payload)
      .then(readJsonOrFriendlyError)
      .then(() => {
        alert('Fila enviada. Recarregando...');
        window.location.reload();
      })
      .catch((error) => {
        err('[integaglpi] fetch failed', error);
        alert('Erro ao enviar ação: ' + (error && error.message ? error.message : String(error)));
        button.disabled = false;
      });
  }

  // POST bloqueado pelo GLPI antes do endpoint executar; manter GET controlado até investigação específica de CSRF/roteamento GLPI.
  // handleSendReplyClick mantido como código experimental — não está conectado a nenhum botão na UI atual.
  function handleSendReplyClick(button) {
    const ticketId       = button.dataset ? (button.dataset.ticketId       || '') : '';
    const conversationId = button.dataset ? (button.dataset.conversationId || '') : '';
    const replyUrl       = button.dataset ? (button.dataset.replyUrl       || '') : '';

    log('[integaglpi][outbound][JS] reply_url = ' + replyUrl);

    const textEl = document.getElementById('integaglpi-reply-text');
    const text   = textEl ? String(textEl.value || '').trim() : '';

    var csrfToken  = '';
    var csrfSource = 'missing';
    var csrfInput  = document.querySelector('input[name="_glpi_csrf_token"]');
    var csrfMetaP  = document.querySelector('meta[property="glpi:csrf_token"]');
    var csrfMetaN  = document.querySelector('meta[name="csrf-token"]');
    if (csrfInput && String(csrfInput.value || '').trim() !== '') {
      csrfToken  = String(csrfInput.value).trim();
      csrfSource = 'input';
    } else if (csrfMetaP && String(csrfMetaP.getAttribute('content') || '').trim() !== '') {
      csrfToken  = String(csrfMetaP.getAttribute('content')).trim();
      csrfSource = 'meta-property';
    } else if (csrfMetaN && String(csrfMetaN.getAttribute('content') || '').trim() !== '') {
      csrfToken  = String(csrfMetaN.getAttribute('content')).trim();
      csrfSource = 'meta-name';
    }
    log('[integaglpi][outbound][JS] csrf source = ' + csrfSource);

    log('[integaglpi][outbound][JS] sending', {
      method:         'POST',
      url:            replyUrl,
      ticketId:       ticketId,
      conversationId: conversationId,
      text_len:       text.length,
      csrf:           csrfToken ? 'present' : 'MISSING'
    });

    if (!replyUrl) {
      warn('[integaglpi][outbound][JS] replyUrl empty');
      alert('replyUrl vazio. Não é possível enviar.');
      return;
    }
    if (!ticketId || !conversationId) {
      warn('[integaglpi][outbound][JS] missing ticketId or conversationId');
      return;
    }
    if (text === '') {
      alert('Mensagem vazia. Digite algo antes de enviar.');
      return;
    }
    if (csrfToken === '') {
      warn('[integaglpi][outbound][JS] CSRF token not found — aborting POST');
      alert('Token CSRF não encontrado. Recarregue a página.');
      return;
    }

    button.disabled = true;
    postUrlEncoded(replyUrl, {
      ticket_id:          ticketId,
      conversation_id:    conversationId,
      reply_text:         text,
      _glpi_csrf_token:   csrfToken
    })
      .then(function (r) {
        var status = r.status;
        var ct     = r.headers.get('content-type') || '';
        return r.text().then(function (body) {
          log('[integaglpi][outbound][JS] raw_response', {
            status:       status,
            content_type: ct,
            body_start:   body.substring(0, 120)
          });

          if (body.trimStart().charAt(0) === '<') {
            err('[integaglpi][outbound][JS] HTML recebido — endpoint não chegou a responder JSON', {
              status:       status,
              content_type: ct,
              body_300:     body.substring(0, 300)
            });
            alert('Erro: endpoint retornou HTML em vez de JSON.\nVerifique os logs do PHP (error_log).');
            button.disabled = false;
            return;
          }

          var resp;
          try {
            resp = JSON.parse(body);
          } catch (parseErr) {
            err('[integaglpi][outbound][JS] JSON.parse falhou', parseErr, body.substring(0, 200));
            alert('Erro: resposta não é JSON válido.\nBody: ' + body.substring(0, 120));
            button.disabled = false;
            return;
          }

          log('[integaglpi][outbound][JS] response', resp);
          if (resp && resp.success) {
            if (textEl) { textEl.value = ''; }
            window.location.reload();
          } else {
            var msg = (resp && resp.message) ? resp.message : (resp && resp.error ? resp.error : 'resposta inválida');
            alert('Erro ao enviar: ' + msg);
            button.disabled = false;
          }
        });
      })
      .catch(function (error) {
        err('[integaglpi][outbound][JS] fetch error', error);
        alert('Erro na requisição: ' + (error && error.message ? error.message : String(error)));
        button.disabled = false;
      });
  }

  function handleTicketActionClick(button) {
    const action = button.dataset ? (button.dataset.action || '') : '';
    const ticketId = button.dataset ? (button.dataset.ticketId || '') : '';
    const conversationId = button.dataset ? (button.dataset.conversationId || '') : '';
    const actionUrl = button.dataset ? (button.dataset.actionUrl || '') : '';

    if (!actionUrl) {
      warn('[integaglpi][ticket] actionUrl empty');
      alert('actionUrl vazio. Não é possível enviar.');
      return;
    }
    if (!action || !ticketId || !conversationId) {
      warn('[integaglpi][ticket] missing action/ticketId/conversationId', { action, ticketId, conversationId });
      return;
    }

    const payload = {
      ticket_id: ticketId,
      conversation_id: conversationId,
      whatsapp_action: action
    };

    if (action === 'transfer') {
      const wrapper = findClosest(button, '.card-body') || document;
      const select = wrapper.querySelector('select.js-integaglpi-wa-queue');
      const queueId = select ? String(select.value || '') : '';
      if (!queueId) {
        alert('Selecione uma fila válida.');
        return;
      }
      payload.queue_id = queueId;
    }

    log('[integaglpi] ticket action clicked', payload);
    log('[integaglpi] ticket payload', payload);

    button.disabled = true;
    postUrlEncoded(actionUrl, payload)
      .then(readJsonOrFriendlyError)
      .then(() => {
        alert('Ação enviada. Recarregando...');
        window.location.reload();
      })
      .catch((error) => {
        err('[integaglpi] fetch failed', error);
        alert('Erro ao enviar ação: ' + (error && error.message ? error.message : String(error)));
        button.disabled = false;
      });
  }

  function readFormCsrfToken(form) {
    const csrfInput = form ? form.querySelector('input[name="_glpi_csrf_token"]') : null;
    return csrfInput ? String(csrfInput.value || '').trim() : '';
  }

  function updateFormCsrfToken(form, token) {
    if (!form || !token) return;
    const csrfInput = form.querySelector('input[name="_glpi_csrf_token"]');
    if (csrfInput) {
      csrfInput.value = String(token);
    }
  }

  function smartHelpPanelMessage(panel, text, cls) {
    const msg = panel ? panel.querySelector('.js-smart-help-message') : null;
    if (msg) {
      msg.textContent = text || '';
      msg.className = 'mt-2 small js-smart-help-message text-' + (cls || 'muted');
    }
  }

  function smartHelpPanelStatus(panel, text, cls) {
    const status = panel ? panel.querySelector('.js-smart-help-status') : null;
    if (status) {
      status.textContent = text || '';
      status.className = 'badge bg-' + (cls || 'secondary') + ' js-smart-help-status';
    }
  }

  function smartHelpSummary(panel) {
    const summary = panel ? panel.querySelector('.js-smart-help-technical-summary') : null;
    return summary ? String(summary.value || '').trim() : '';
  }

  function smartHelpSetSummary(panel, text) {
    const summary = panel ? panel.querySelector('.js-smart-help-technical-summary') : null;
    if (summary && text) {
      summary.value = String(text);
    }
  }

  function smartHelpRefreshCsrf(panel) {
    if (!panel || !panel.dataset || !panel.dataset.actionUrl) {
      return Promise.resolve(false);
    }
    const sep = panel.dataset.actionUrl.indexOf('?') === -1 ? '?' : '&';
    const url = panel.dataset.actionUrl + sep + 'csrf_token=1&_=' + String(Date.now());
    return fetch(url, {
      method: 'GET',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: {
        'Accept': 'application/json',
        'Cache-Control': 'no-store',
        'X-Requested-With': 'XMLHttpRequest'
      }
    })
      .then((response) => response.json().catch(() => null))
      .then((body) => {
        if (body && typeof body.csrf_token === 'string' && body.csrf_token !== '') {
          panel.dataset.csrf = body.csrf_token;
          return true;
        }
        return false;
      })
      .catch(() => false);
  }

  function smartHelpPost(panel, action, extra) {
    const params = new URLSearchParams();
    const token = panel.dataset.csrf || '';
    params.set('smart_action', action);
    params.set('ticket_id', panel.dataset.ticketId || '0');
    params.set('_glpi_csrf_token', token);
    params.set('csrf_token', token);
    Object.keys(extra || {}).forEach((key) => {
      params.set(key, String(extra[key]));
    });

    return fetch(panel.dataset.actionUrl || '', {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json',
        'X-Requested-With': 'XMLHttpRequest',
        'X-Glpi-Csrf-Token': token
      },
      body: params.toString()
    }).then((response) => response.text().then((text) => {
      let body = null;
      try { body = text ? JSON.parse(text) : null; } catch (e) { body = null; }
      if (body && typeof body.csrf_token === 'string' && body.csrf_token !== '') {
        panel.dataset.csrf = body.csrf_token;
      }
      return { status: response.status, ok: response.ok, body };
    }));
  }

  function smartHelpRenderLocal(panel, result) {
    const r = result || {};
    if (typeof r.technicalSummary === 'string' && r.technicalSummary.trim() !== '') {
      smartHelpSetSummary(panel, r.technicalSummary);
    }
    const articlesEl = panel.querySelector('.js-smart-help-articles');
    if (articlesEl) {
      const articles = Array.isArray(r.articles) ? r.articles : [];
      articlesEl.innerHTML = articles.length
        ? articles.slice(0, 5).map((article) => {
          const title = String(article.title || article.name || 'Artigo local');
          const score = article.score != null ? ' · score ' + String(article.score) : '';
          return '<div class="border rounded p-2 mb-2"><strong>' + title.replace(/[<>&]/g, '') + '</strong><span class="text-muted">' + score + '</span></div>';
        }).join('')
        : '<div class="text-muted">Nenhum artigo local conclusivo.</div>';
    }
    const checklistEl = panel.querySelector('.js-smart-help-checklist');
    if (checklistEl) {
      const checklist = Array.isArray(r.checklist) ? r.checklist : [];
      checklistEl.innerHTML = checklist.map((item) => '<li>' + String(item || '').replace(/[<>&]/g, '') + '</li>').join('');
    }
    const questionsEl = panel.querySelector('.js-smart-help-questions');
    if (questionsEl) {
      const questions = Array.isArray(r.questions) ? r.questions : [];
      questionsEl.innerHTML = questions.map((item) => '<li>' + String(item || '').replace(/[<>&]/g, '') + '</li>').join('');
    }
    const localSuggestionEl = panel.querySelector('.js-smart-help-local-suggestion');
    if (localSuggestionEl && r.localSuggestion) {
      localSuggestionEl.innerHTML = '<div class="alert alert-warning py-2 mb-0">' + String(r.localSuggestion).replace(/[<>&]/g, '') + '</div>';
    }
    const localBtn = panel.querySelector('.js-smart-help-local-search');
    const externalBtn = panel.querySelector('.js-smart-help-external');
    if (localBtn) localBtn.disabled = smartHelpSummary(panel) === '';
    if (externalBtn) externalBtn.disabled = smartHelpSummary(panel) === '';
  }

  function handleSmartHelpClick(button, panel, action) {
    if (!panel || panel.dataset.smartHelpGlobalBusy === '1') return;
    if (!panel.dataset.actionUrl) {
      smartHelpPanelMessage(panel, 'Ajuda Inteligente não iniciou: endpoint ausente.', 'warning');
      return;
    }

    const originalText = button ? button.textContent : '';
    if (button) button.disabled = true;
    panel.dataset.smartHelpGlobalBusy = '1';
    smartHelpPanelMessage(panel, 'Processando...', 'muted');
    smartHelpPanelStatus(panel, action === 'summarize_ticket' ? 'resumindo' : (action === 'local_search' ? 'buscando' : 'preparando'), 'secondary');

    const extra = {};
    if (action === 'summarize_ticket') {
      extra.ai_summary = '1';
    }
    if (action === 'local_search' || action === 'prepare_external_context') {
      extra.technical_summary = smartHelpSummary(panel);
    }
    if (action === 'smart_external') {
      extra.technical_summary = smartHelpSummary(panel);
      extra.consent = '1';
    }

    smartHelpRefreshCsrf(panel)
      .then(() => smartHelpPost(panel, action, extra))
      .then((result) => {
        const body = result.body || {};
        if (!result.ok || body.ok === false) {
          smartHelpPanelMessage(panel, body.message || ('Falha SmartHelp HTTP ' + String(result.status)), 'danger');
          smartHelpPanelStatus(panel, 'erro', 'danger');
          return;
        }
        const responseResult = body.result || {};
        if (action === 'prepare_external_context') {
          const cloudEl = panel.querySelector('.js-smart-help-cloud');
          if (cloudEl) {
            cloudEl.innerHTML = '<div class="alert alert-warning py-2 mb-2">Contexto sanitizado preparado para validação humana.</div>'
              + '<button type="button" class="btn btn-sm btn-warning js-smart-help-external-send">Enviar para ajuda externa</button>';
          }
          smartHelpPanelMessage(panel, 'Revise o contexto sanitizado antes de ajuda externa.', 'warning');
          smartHelpPanelStatus(panel, 'validação humana', 'warning');
          return;
        }
        if (action === 'smart_external') {
          const cloudEl = panel.querySelector('.js-smart-help-cloud');
          const message = responseResult.message || responseResult.summary || body.message || 'Resposta externa registrada para revisão humana.';
          if (cloudEl) {
            cloudEl.innerHTML = '<div class="alert alert-info py-2 mb-0">' + String(message).replace(/[<>&]/g, '') + '</div>';
          }
          smartHelpPanelMessage(panel, 'Ajuda externa retornou apenas para revisão humana.', 'info');
          smartHelpPanelStatus(panel, 'revisão humana', 'info');
          return;
        }
        smartHelpRenderLocal(panel, responseResult);
        smartHelpPanelMessage(panel, body.message || 'Ajuda Inteligente atualizada.', 'success');
        smartHelpPanelStatus(panel, action === 'local_search' ? 'busca local' : 'resumo pronto', 'success');
      })
      .catch(() => {
        smartHelpPanelMessage(panel, 'Erro de rede ao executar SmartHelp.', 'danger');
        smartHelpPanelStatus(panel, 'erro', 'danger');
      })
      .finally(() => {
        panel.dataset.smartHelpGlobalBusy = '0';
        if (button) {
          button.disabled = false;
          if (originalText) button.textContent = originalText;
        }
      });
  }

  function handleAiQualityAnalyzeForm(form, event) {
    if (!form) return;
    if (event) {
      event.preventDefault();
      event.stopPropagation();
      if (typeof event.stopImmediatePropagation === 'function') {
        event.stopImmediatePropagation();
      }
    }
    if (form.dataset.submitted === '1') {
      return;
    }

    const button = form.querySelector('.js-integaglpi-ai-quality-analyze-submit');
    const status = form.querySelector('.js-integaglpi-ai-quality-analyze-status');
    const csrfToken = readFormCsrfToken(form);
    const originalText = button ? button.textContent : '';
    form.dataset.submitted = '1';

    if (button) {
      button.disabled = true;
      button.textContent = 'Analisando...';
    }
    if (status) {
      status.textContent = 'Enviando análise para revisão humana...';
      status.className = 'small text-muted ms-2 js-integaglpi-ai-quality-analyze-status';
    }

    fetch(form.action, {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'Accept': 'application/json',
        'X-Requested-With': 'XMLHttpRequest',
        'X-Glpi-Csrf-Token': csrfToken
      },
      body: new FormData(form)
    })
      .then(function (response) {
        return response.text().then(function (text) {
          let body = null;
          if (text) {
            try { body = JSON.parse(text); } catch (e) { body = null; }
          }
          return { status: response.status, body };
        });
      })
      .then(function (result) {
        if (result.body && typeof result.body.csrf_token === 'string') {
          updateFormCsrfToken(form, result.body.csrf_token);
        }
        if (result.body && result.body.ok === true) {
          if (status) {
            status.textContent = result.body.message || 'Análise IA registrada. Atualizando...';
            status.className = 'small text-success ms-2 js-integaglpi-ai-quality-analyze-status';
          }
          window.setTimeout(function () { window.location.reload(); }, 700);
          return;
        }
        let message = result.body && result.body.message
          ? result.body.message
          : 'Não foi possível concluir a análise IA agora.';
        if (result.body && result.body.error_type) {
          message += ' [' + result.body.error_type + ']';
        }
        if (status) {
          status.textContent = message;
          status.className = 'small text-danger ms-2 js-integaglpi-ai-quality-analyze-status';
        }
        form.dataset.submitted = '0';
        if (button) {
          button.disabled = false;
          button.textContent = originalText;
        }
      })
      .catch(function () {
        if (status) {
          status.textContent = 'Erro de rede ao solicitar análise IA.';
          status.className = 'small text-danger ms-2 js-integaglpi-ai-quality-analyze-status';
        }
        form.dataset.submitted = '0';
        if (button) {
          button.disabled = false;
          button.textContent = originalText;
        }
      });
  }

  function onDocumentClick(event) {
    const target = event.target;
    if (!target) return;

    const aiQualityBtn = findClosest(target, '.js-integaglpi-ai-quality-analyze-submit');
    if (aiQualityBtn) {
      handleAiQualityAnalyzeForm(findClosest(aiQualityBtn, '.js-integaglpi-ai-quality-analyze-form'), event);
      return;
    }

    const smartHelpButton = findClosest(target, '.integaglpi-smart-help .js-smart-help-summarize, .integaglpi-smart-help .js-smart-help-local-search, .integaglpi-smart-help .js-smart-help-external, .integaglpi-smart-help .js-smart-help-external-send');
    if (smartHelpButton) {
      event.preventDefault();
      event.stopPropagation();
      if (typeof event.stopImmediatePropagation === 'function') {
        event.stopImmediatePropagation();
      }
      const panel = findClosest(smartHelpButton, '.integaglpi-smart-help');
      const action = findClosest(smartHelpButton, '.js-smart-help-local-search')
        ? 'local_search'
        : (findClosest(smartHelpButton, '.js-smart-help-external-send') ? 'smart_external'
          : (findClosest(smartHelpButton, '.js-smart-help-external') ? 'prepare_external_context' : 'summarize_ticket'));
      handleSmartHelpClick(smartHelpButton, panel, action);
      return;
    }

    const queueSaveBtn = findClosest(target, 'button.js-integaglpi-queue-save');
    if (queueSaveBtn) {
      event.preventDefault();
      handleQueueSaveClick(queueSaveBtn);
      return;
    }

    const ticketActionBtn = findClosest(target, 'button.js-integaglpi-ticket-action');
    if (ticketActionBtn) {
      event.preventDefault();
      handleTicketActionClick(ticketActionBtn);
      return;
    }
  }

  function onDocumentSubmit(event) {
    const target = event.target;
    if (!target) return;

    const aiQualityForm = findClosest(target, '.js-integaglpi-ai-quality-analyze-form');
    if (aiQualityForm) {
      handleAiQualityAnalyzeForm(aiQualityForm, event);
    }
  }

  function init() {
    log('[integaglpi] external JS loaded');
    // Native delegation fallback (works even without jQuery).
    document.removeEventListener('click', onDocumentClick, false);
    document.addEventListener('click', onDocumentClick, false);
    document.removeEventListener('submit', onDocumentSubmit, true);
    document.addEventListener('submit', onDocumentSubmit, true);
    initSidebarMenuTreePersistence();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Preferred in GLPI: jQuery delegated events (captures dynamically injected content).
  if (typeof jQuery !== 'undefined' && jQuery && jQuery(document) && jQuery(document).on) {
    // Register delegated click handlers once (namespaced).
    jQuery(document)
      .off('click.integaglpiExternalQueueSave', 'button.js-integaglpi-queue-save')
      .on('click.integaglpiExternalQueueSave', 'button.js-integaglpi-queue-save', function (e) {
        e.preventDefault();
        handleQueueSaveClick(this);
      });

    jQuery(document)
      .off('click.integaglpiExternalTicketAction', 'button.js-integaglpi-ticket-action')
      .on('click.integaglpiExternalTicketAction', 'button.js-integaglpi-ticket-action', function (e) {
        e.preventDefault();
        handleTicketActionClick(this);
      });

    jQuery(document).on('click', '.js-integaglpi-send-reply', function (e) {
      e.preventDefault();
      handleSendReplyClick(this);
    });

    // Re-run init after GLPI AJAX updates (safe/idempotent).
    jQuery(document)
      .off('ajaxComplete.integaglpiExternal')
      .on('ajaxComplete.integaglpiExternal', function () {
        init();
      });
  }
})();
