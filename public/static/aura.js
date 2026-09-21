/**
 * Aura Luxe — Phase 1 command bar + chat panel interactivity.
 *
 * EXPLICIT SCOPE (Pat's Section 10/11 directive): this is a "prepared UI
 * integration point", NOT a fake AI. Every interactive control below is
 * fully functional as a UI (text fills, buttons respond, panel opens/
 * closes) but nothing here pretends to search, book, order, or otherwise
 * take a real action — because there is no real Aura backend to call yet
 * (that is Phase 3). Submitting the command bar or the chat panel shows an
 * honest, clearly-labeled "Aura isn't connected yet" state instead of any
 * scripted fake response like "Your order has been placed" or a fabricated
 * search result. When Phase 3 wires the real backend, the ONLY change
 * needed here is replacing showDemoResponse()'s body with a real
 * fetch('/api/aura/...') call — the DOM structure, event wiring, and every
 * component in aura.tsx are already built to receive that swap without a
 * redesign.
 */
(function () {
  'use strict';

  function showDemoResponse(targetEl, promptText) {
    if (!targetEl) return;
    targetEl.textContent =
      'Aura isn\u2019t connected to live search or actions yet \u2014 this is a Phase 1 preview of the interface. ' +
      (promptText ? ('You asked: \u201c' + promptText + '\u201d. ') : '') +
      'Real answers arrive in Phase 3.';
    targetEl.classList.remove('hidden');
  }

  function ensureDemoNotice(afterEl, idSuffix) {
    var id = 'aura-demo-notice-' + idSuffix;
    var existing = document.getElementById(id);
    if (existing) return existing;
    var el = document.createElement('div');
    el.id = id;
    el.className = 'hidden mt-2 text-[11px] leading-snug text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2';
    afterEl.insertAdjacentElement('afterend', el);
    return el;
  }

  document.addEventListener('DOMContentLoaded', function () {
    // ---- Command bar (main center column) ----
    var commandForm = document.getElementById('aura-command-form');
    var commandInput = document.getElementById('aura-command-input');
    if (commandForm && commandInput) {
      var commandNotice = ensureDemoNotice(commandForm, 'command');
      commandForm.addEventListener('submit', function (e) {
        e.preventDefault();
        showDemoResponse(commandNotice, commandInput.value.trim());
      });
    }

    // Quick prompt chips fill the command bar input (real, functional UI —
    // just doesn't trigger a fabricated AI answer on click).
    document.querySelectorAll('.aura-quick-prompt').forEach(function (btn) {
      btn.addEventListener('click', function () {
        if (commandInput) {
          commandInput.value = btn.getAttribute('data-prompt') || '';
          commandInput.focus();
        }
      });
    });

    // Mic / image / location buttons in the command bar — prepared
    // integration points only. Phase 3 wires these to the Web Speech API /
    // file picker / Geolocation API + the real Aura backend.
    ['aura-mic-btn', 'aura-attach-image-btn', 'aura-location-btn'].forEach(function (id) {
      var btn = document.getElementById(id);
      if (!btn) return;
      btn.addEventListener('click', function () {
        var notice = ensureDemoNotice(commandForm || btn, id);
        notice.textContent = 'This control is a prepared UI integration point \u2014 not yet wired to a backend (Phase 3).';
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
      var chatNotice = ensureDemoNotice(chatInput.closest('div'), 'chat');
      chatSendBtn.addEventListener('click', function () {
        showDemoResponse(chatNotice, chatInput.value.trim());
      });
      chatInput.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') {
          e.preventDefault();
          showDemoResponse(chatNotice, chatInput.value.trim());
        }
      });
    }

    // ---- Mobile/tablet "Chat with Aura" bottom sheet ----
    // Phase 2 responsive: the same Aura chat surface as the desktop floating
    // panel above, just presented as a slide-up sheet on md..<dt widths
    // (opened from the bottom-nav Aura pill on mobile, or the FAB on tablet).
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
      var chatSheetNotice = ensureDemoNotice(chatSheetInput.closest('div'), 'chat-sheet');
      chatSheetSendBtn.addEventListener('click', function () {
        showDemoResponse(chatSheetNotice, chatSheetInput.value.trim());
      });
      chatSheetInput.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') {
          e.preventDefault();
          showDemoResponse(chatSheetNotice, chatSheetInput.value.trim());
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
