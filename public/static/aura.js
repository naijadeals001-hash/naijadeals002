/**
 * Aura Luxe — command bar + chat panel interactivity.
 *
 * PHASE 3 WIRING (Workstream C): every interactive control below now calls
 * the REAL, working Aura backend at POST /api/aura/chat (src/routes/api-aura.ts
 * -> src/lib/aura-ai/orchestrator.ts + llm-client.ts) instead of the old
 * showDemoResponse() canned "Aura isn't connected yet" placeholder. The
 * backend itself was already live and verified working (curl-tested on both
 * local and production) BEFORE this change — this file was the only piece
 * standing between the real backend and the UI. The backend's own system
 * prompt (see orchestrator.ts) is explicitly instructed to never fabricate
 * marketplace data and to honestly disclose when it doesn't have access to
 * live search/booking/order data yet — so no fake AI capability is being
 * claimed here, only a real (if still limited) assistant being connected to
 * the UI that was built for it.
 *
 * The mic / image / location buttons remain deliberately NOT wired — those
 * are genuinely prepared-but-unbuilt integration points (Web Speech API /
 * file picker / Geolocation API), so they keep their honest
 * "not yet wired" notice rather than being falsely presented as live.
 */
(function () {
  'use strict';

  var conversationId = null;

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /**
   * Sends `message` to the real Aura chat endpoint and renders the
   * response (or an honest error) into targetEl. Disables sendBtn and
   * shows a "Thinking..." state while the request is in flight so users
   * get real feedback instead of an instant fake reply.
   */
  function sendToAura(targetEl, sendBtn, message) {
    if (!targetEl || !message) return;
    targetEl.classList.remove('hidden');
    targetEl.textContent = 'Aura is thinking…';
    if (sendBtn) sendBtn.disabled = true;

    fetch('/api/aura/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        conversation_id: conversationId,
        message: message,
        experience: 'luxe',
      }),
    })
      .then(function (res) {
        return res.json().then(function (data) { return { ok: res.ok, data: data }; });
      })
      .then(function (result) {
        if (sendBtn) sendBtn.disabled = false;
        if (!result.ok) {
          targetEl.textContent = (result.data && result.data.error) || 'Aura could not process that request right now. Please try again.';
          return;
        }
        var resp = result.data;
        if (resp && resp.conversation_id) conversationId = resp.conversation_id;
        var text = (resp && resp.message) || "Aura didn't return a response. Please try again.";
        targetEl.textContent = text;
      })
      .catch(function () {
        if (sendBtn) sendBtn.disabled = false;
        targetEl.textContent = 'Aura could not be reached right now. Please check your connection and try again.';
      });
  }

  function ensureResponseArea(afterEl, idSuffix) {
    var id = 'aura-response-' + idSuffix;
    var existing = document.getElementById(id);
    if (existing) return existing;
    var el = document.createElement('div');
    el.id = id;
    el.className = 'hidden mt-2 text-[12px] leading-snug text-white/90 bg-black/25 border border-white/10 rounded-lg px-3 py-2 whitespace-pre-wrap';
    afterEl.insertAdjacentElement('afterend', el);
    return el;
  }

  // The command bar lives on a light background (white pill), so its
  // response area needs light-surface styling instead of the dark chat
  // panel's styling used by ensureResponseArea() above.
  function ensureCommandResponseArea(afterEl) {
    var id = 'aura-response-command';
    var existing = document.getElementById(id);
    if (existing) return existing;
    var el = document.createElement('div');
    el.id = id;
    el.className = 'hidden mt-2 text-[12.5px] leading-snug text-gray-700 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2.5 whitespace-pre-wrap';
    afterEl.insertAdjacentElement('afterend', el);
    return el;
  }

  document.addEventListener('DOMContentLoaded', function () {
    // ---- Command bar (main center column) ----
    var commandForm = document.getElementById('aura-command-form');
    var commandInput = document.getElementById('aura-command-input');
    var commandSendBtn = document.getElementById('aura-send-btn');
    if (commandForm && commandInput) {
      var commandResponse = ensureCommandResponseArea(commandForm);
      commandForm.addEventListener('submit', function (e) {
        e.preventDefault();
        var msg = commandInput.value.trim();
        if (!msg) return;
        sendToAura(commandResponse, commandSendBtn, msg);
      });
    }

    // Quick prompt chips fill the command bar input (real, functional UI).
    document.querySelectorAll('.aura-quick-prompt').forEach(function (btn) {
      btn.addEventListener('click', function () {
        if (commandInput) {
          commandInput.value = btn.getAttribute('data-prompt') || '';
          commandInput.focus();
        }
      });
    });

    // Mic / image / location buttons in the command bar — still genuinely
    // prepared-but-unbuilt integration points (Web Speech API / file
    // picker / Geolocation API), honestly labeled as such.
    ['aura-mic-btn', 'aura-attach-image-btn', 'aura-location-btn'].forEach(function (id) {
      var btn = document.getElementById(id);
      if (!btn) return;
      btn.addEventListener('click', function () {
        var notice = ensureCommandResponseArea(commandForm || btn);
        notice.textContent = 'This control is a prepared UI integration point — not yet wired to a backend.';
        notice.classList.remove('hidden');
      });
    });

    // ---- Floating "Chat with Aura" panel ----
    var chatPanel = document.getElementById('aura-chat-panel');
    var closeBtn = document.getElementById('aura-chat-close-btn');
    var expandBtn = document.getElementById('aura-chat-expand-btn');
    var chatInput = document.getElementById('aura-chat-input');
    var chatSendBtn = document.getElementById('aura-chat-send-btn');

    if (closeBtn && chatPanel) {
      closeBtn.addEventListener('click', function () {
        chatPanel.classList.add('hidden');
      });
    }
    if (expandBtn && chatPanel) {
      expandBtn.addEventListener('click', function () {
        chatPanel.classList.toggle('!w-[420px]');
      });
    }

    document.querySelectorAll('.aura-chat-suggestion').forEach(function (btn) {
      btn.addEventListener('click', function () {
        if (chatInput) {
          chatInput.value = btn.getAttribute('data-prompt') || '';
          chatInput.focus();
        }
      });
    });

    if (chatSendBtn && chatInput) {
      var chatResponse = ensureResponseArea(chatInput.closest('div'), 'chat');
      var sendChat = function () {
        var msg = chatInput.value.trim();
        if (!msg) return;
        sendToAura(chatResponse, chatSendBtn, msg);
      };
      chatSendBtn.addEventListener('click', sendChat);
      chatInput.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') {
          e.preventDefault();
          sendChat();
        }
      });
    }

    // ---- Mobile/tablet "Chat with Aura" bottom sheet ----
    // Same Aura chat surface as the desktop floating panel above, just
    // presented as a slide-up sheet on md..<dt widths (opened from the
    // bottom-nav Aura pill on mobile, or the FAB on tablet).
    var chatSheet = document.getElementById('aura-chat-sheet');
    var chatSheetBackdrop = document.getElementById('aura-chat-sheet-backdrop');
    var chatSheetOpenTriggers = [
      document.getElementById('aura-bottom-nav-aura-btn'),
      document.getElementById('aura-chat-fab'),
    ].filter(Boolean);
    var chatSheetCloseBtn = document.getElementById('aura-chat-sheet-close-btn');
    var chatSheetInput = document.getElementById('aura-chat-sheet-input');
    var chatSheetSendBtn = document.getElementById('aura-chat-sheet-send-btn');

    function openChatSheet() {
      if (!chatSheet) return;
      chatSheet.classList.remove('hidden');
      if (chatSheetBackdrop) chatSheetBackdrop.classList.remove('hidden');
      document.body.style.overflow = 'hidden';
    }
    function closeChatSheet() {
      if (!chatSheet) return;
      chatSheet.classList.add('hidden');
      if (chatSheetBackdrop) chatSheetBackdrop.classList.add('hidden');
      document.body.style.overflow = '';
    }

    chatSheetOpenTriggers.forEach(function (btn) {
      btn.addEventListener('click', openChatSheet);
    });
    if (chatSheetCloseBtn) chatSheetCloseBtn.addEventListener('click', closeChatSheet);
    if (chatSheetBackdrop) chatSheetBackdrop.addEventListener('click', closeChatSheet);

    document.querySelectorAll('.aura-chat-suggestion-sheet').forEach(function (btn) {
      btn.addEventListener('click', function () {
        if (chatSheetInput) {
          chatSheetInput.value = btn.getAttribute('data-prompt') || '';
          chatSheetInput.focus();
        }
      });
    });

    if (chatSheetSendBtn && chatSheetInput) {
      var chatSheetResponse = ensureResponseArea(chatSheetInput.closest('div'), 'chat-sheet');
      var sendChatSheet = function () {
        var msg = chatSheetInput.value.trim();
        if (!msg) return;
        sendToAura(chatSheetResponse, chatSheetSendBtn, msg);
      };
      chatSheetSendBtn.addEventListener('click', sendChatSheet);
      chatSheetInput.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') {
          e.preventDefault();
          sendChatSheet();
        }
      });
    }

    // Safety net: if the viewport crosses back to desktop (>=1440px) while
    // the sheet is open (e.g. rotating a tablet or resizing a window), close
    // it so it never gets stuck open behind/alongside the desktop floating
    // chat panel.
    window.addEventListener('resize', function () {
      if (window.innerWidth >= 1440) closeChatSheet();
    });
  });
})();
