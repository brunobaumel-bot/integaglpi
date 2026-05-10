/* global jQuery */
(function () {
  'use strict';

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
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'X-Requested-With': 'XMLHttpRequest'
      },
      body: params.toString()
    });
  }

  function findClosest(el, selector) {
    if (!el) return null;
    if (el.closest) return el.closest(selector);
    // IE fallback not needed; GLPI 11 supported browsers have closest.
    return null;
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
    alert('Clique capturado pelo integaglpi');

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
    alert('Clique capturado pelo integaglpi');

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

  function onDocumentClick(event) {
    const target = event.target;
    if (!target) return;

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

  function init() {
    log('[integaglpi] external JS loaded');
    // Native delegation fallback (works even without jQuery).
    document.removeEventListener('click', onDocumentClick, false);
    document.addEventListener('click', onDocumentClick, false);
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

