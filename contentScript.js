// contentScript.js
// Full replacement — Smart tagging integrated into Quick-Edit and direct saves.
// Preserves banner, insert, hotkey, selection flows, safe write fallback to storage,
// and sends structured save messages to background: { type: 'saveSelection', ... }.

// I keep local-first tag inference for speed and privacy. The quick-edit shows suggested chips
// and allows adding custom tags (press Enter). Shift+Save opens quick-edit with suggestions.

(function () {
  // ---------- Utilities ----------
  function debounce(fn, wait = 120) {
    let t;
    return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), wait); };
  }
  function safeStorageGet(keys, timeout = 700) {
    return new Promise((resolve) => {
      let done = false;
      function finish(obj){ if(done) return; done = true; resolve(obj||{}); }
      try { if(typeof chrome === "undefined" || !chrome.storage || !chrome.storage.local || !chrome.storage.local.get) return finish({}); } catch(e){ return finish({}); }
      try {
        chrome.storage.local.get(keys, (res) => {
          if (chrome.runtime && chrome.runtime.lastError) return finish({});
          finish(res || {});
        });
      } catch(e) { finish({}); }
      setTimeout(()=>finish({}), timeout);
    });
  }
  function safeStorageSet(obj) {
    return new Promise((resolve) => {
      try { chrome.storage.local.set(obj, () => resolve()); } catch (e) { resolve(); }
    });
  }
  function uid(prefix = 'm') {
    return prefix + '_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2,8);
  }

  // ---------- Tag inference (local, privacy-first) ----------
  // keyword map tuned to OML use-cases; cheap and deterministic
  const LOCAL_TAG_KEYWORDS = {
    ai: ["ai","llm","gpt","claude","gemini","model","embedding","inference","prompt","openai","anthropic"],
    design: ["design","ux","ui","prototype","wireframe","interface","visual","usability","framer","figma"],
    product: ["product","launch","mvp","users","metrics","growth","market","scale","startup"],
    sync: ["sync","cloud","backup","drive","supabase","firebase","syncing","google"],
    memory: ["memory","memories","store","context","insert","save","recall"],
    code: ["code","javascript","python","repo","github","open-source","react","typescript","node"],
    research: ["research","paper","study","analysis","dataset","findings"],
    personal: ["i","my","me","goal","aspire","joined","graduat","hult","university"],
    privacy: ["privacy","data","consent","gdpr","secure","encrypted"],
    health: ["mental","therapy","wellness","health","haven","rant"]
  };

  function tokenizeForTags(text = "") {
    return String(text || "").toLowerCase().split(/\W+/).filter(Boolean);
  }
  function inferTagsLocal(text = "", max = 4) {
    if (!text) return [];
    const tokens = tokenizeForTags(text);
    if (!tokens.length) return [];
    const scores = {};
    for (const [tag, kws] of Object.entries(LOCAL_TAG_KEYWORDS)) {
      let s = 0;
      for (const kw of kws) {
        if (kw.includes(" ")) {
          if (text.toLowerCase().includes(kw)) s += 2;
        } else {
          tokens.forEach(t => { if (t === kw) s += 1; });
        }
      }
      if (s > 0) scores[tag] = s;
    }
    return Object.entries(scores)
      .sort((a,b)=>b[1]-a[1])
      .map(x=>x[0])
      .slice(0, max);
  }

  // ---------- relevance helpers ----------
  const STOPWORDS = new Set(["the","is","at","which","on","and","a","an","for","to","in","of","with","that","this","i","you","it","we","they","my","your"]);
  function tokenize(text=""){ return String(text || "").toLowerCase().split(/\W+/).filter(Boolean).filter(t=>!STOPWORDS.has(t)); }
  function overlapScore(a,b){ if(!a.length||!b.length) return 0; const setB=new Set(b); let c=0; a.forEach(t=>setB.has(t)&&c++); return c; }
  function pickRelevant(memoryObj, query="", max=3) {
    if (!memoryObj || !Array.isArray(memoryObj.memory) || memoryObj.memory.length===0) return "";
    const facts = memoryObj.memory;
    const inputTokens = tokenize(query||"");
    const scored = facts.map((f, idx) => {
      const text = (typeof f === 'string') ? f : (f.text || "");
      return { idx, text, score: overlapScore(inputTokens, tokenize(text)) };
    });
    scored.sort((a,b)=>b.score - a.score);
    const top = scored.filter(s=>s.score>0);
    const chosen = (top.length ? top : scored).slice(0, max).map(x=>x.text);
    return chosen.join(" ");
  }

  // ---------- DOM helpers ----------
  function isVisible(el){ if(!el) return false; try{ const r=el.getBoundingClientRect(); return r.width>0 && r.height>0; } catch(e){ return false; } }
  function findEditable() {
    try {
      const ta = document.querySelector("textarea");
      if (ta && isVisible(ta)) return ta;
      const input = document.querySelector('input[type="text"]');
      if (input && isVisible(input)) return input;
      const ce = Array.from(document.querySelectorAll('[contenteditable="true"], [role="textbox"]')).find(isVisible);
      if (ce) return ce;
    } catch(e){}
    return null;
  }

  // ---------- Safe insert (unchanged) ----------
  async function safeInsert(el, rawText) {
    if (!el || !rawText) return false;
    const ctxText = rawText.replace(/\s+/g,' ').trim().slice(0, 600);
    const insertString = `\n[Context: ${ctxText}]\n`;
    const preValue = (el.tagName === "TEXTAREA" || el.tagName === "INPUT") ? (el.value || "") : (el.innerText || "");
    let inserted = false;
    try {
      if (el.tagName === "TEXTAREA" || (el.tagName === "INPUT" && el.type === "text")) {
        const start = el.selectionStart || 0, end = el.selectionEnd || 0;
        const before = el.value.slice(0,start), after = el.value.slice(end);
        try { el.focus({preventScroll:true}); } catch(_) { el.focus(); }
        el.value = `${before}${insertString}${after}`;
        const pos = before.length + insertString.length;
        try { el.setSelectionRange(pos,pos); } catch(e){}
        el.dispatchEvent(new Event("input",{bubbles:true}));
        inserted = true;
      } else {
        el.focus();
        const ok = document.execCommand && document.execCommand("insertText", false, insertString);
        if (!ok) {
          const sel = window.getSelection();
          if (sel && sel.rangeCount > 0) {
            const range = sel.getRangeAt(0);
            const node = document.createTextNode(insertString);
            range.deleteContents();
            range.insertNode(node);
            range.setStartAfter(node);
            range.collapse(true);
            sel.removeAllRanges();
            sel.addRange(range);
          } else {
            el.appendChild(document.createTextNode(insertString));
          }
        }
        el.dispatchEvent(new InputEvent("input",{bubbles:true}));
        inserted = true;
      }
    } catch(e) { inserted = false; }

    // guard against auto-submit sites
    await new Promise(r=>setTimeout(r,220));
    try {
      const nowVal = (el && (el.tagName === "TEXTAREA" || el.tagName === "INPUT")) ? (el.value || "") : (el && el.innerText ? el.innerText : null);
      if ((typeof nowVal === "string") && preValue.trim() !== "" && nowVal.trim() === "") {
        if (el.tagName === "TEXTAREA" || el.tagName === "INPUT") {
          el.value = preValue; el.dispatchEvent(new Event("input",{bubbles:true}));
        }
        try { await navigator.clipboard.writeText(insertString); alert("OML: site auto-submitted. Context copied to clipboard. Paste with Ctrl+V."); } catch(e){ alert("OML: couldn't insert; please copy/paste manually."); }
        return false;
      }
    } catch(e){}
    return inserted;
  }

  // ---------- Theme detection ----------
  function rgbToLuminance(rgbStr) {
    try {
      const m = rgbStr.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
      if (!m) return null;
      const r = parseInt(m[1],10)/255, g = parseInt(m[2],10)/255, b = parseInt(m[3],10)/255;
      const srgb = [r,g,b].map(c => c <= 0.03928 ? c/12.92 : Math.pow((c+0.055)/1.055,2.4));
      return 0.2126*srgb[0] + 0.7152*srgb[1] + 0.0722*srgb[2];
    } catch(e){ return null; }
  }
  function detectTheme() {
    try {
      const bodyStyle = getComputedStyle(document.body);
      const bg = bodyStyle && bodyStyle.backgroundColor ? bodyStyle.backgroundColor : "";
      const lum = rgbToLuminance(bg);
      if (lum !== null) return lum < 0.5 ? "dark" : "light";
      if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) return "dark";
    } catch(e){}
    return "light";
  }

  // ---------- Banner (same look & behavior) ----------
  const SVG_LOGO = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 256 256" fill="none"><path d="M 164 0 C 188.301 0 208 19.7 208 44 C 208 45.417 207.93 46.818 207.799 48.2 C 209.182 48.07 210.583 48 212 48 C 236.301 48 256 67.7 256 92 C 256 106.883 248.609 120.037 237.3 128 C 248.609 135.963 256 149.117 256 164 C 256 188.301 236.301 208 212 208 C 210.583 208 209.182 207.93 207.799 207.799 C 207.93 209.182 208 210.583 208 212 C 208 236.301 188.301 256 164 256 C 149.117 256 135.963 248.609 128 237.3 C 120.037 248.609 106.883 256 92 256 C 67.7 256 48 236.301 48 212 C 48 210.583 48.07 209.182 48.2 207.799 C 46.804 207.932 45.402 207.999 44 208 C 19.7 208 0 188.301 0 164 C 0 149.118 7.39 135.963 18.7 128 C 7.39 120.037 0 106.882 0 92 C 0 67.7 19.7 48 44 48 C 45.417 48 46.818 48.07 48.2 48.2 C 48.07 46.818 48 45.417 48 44 C 48 19.7 67.7 0 92 0 C 106.882 0 120.037 7.39 128 18.7 C 135.963 7.39 149.118 0 164 0 Z M 128 69.3 C 120.037 80.61 106.883 88 92 88 C 90.583 88 89.182 87.93 87.799 87.799 C 87.932 89.195 87.999 90.597 88 92 C 88 106.883 80.61 120.037 69.3 128 C 80.61 135.963 88 149.117 88 164 C 88 165.417 87.93 166.818 87.799 168.2 C 89.182 168.069 90.583 168 92 168 C 106.882 168 120.037 175.39 128 186.699 C 135.963 175.39 149.118 168 164 168 C 165.417 168 166.818 168.069 168.2 168.2 C 168.067 166.804 168 165.402 168 164 C 168 149.118 175.39 135.963 186.699 128 C 175.39 120.037 168 106.882 168 92 C 168 90.583 168.069 89.182 168.2 87.799 C 166.804 87.932 165.402 87.999 164 88 C 149.117 88 135.963 80.61 128 69.3 Z" fill="currentColor"></path></svg>`;

  function createBannerElement(theme) {
    const banner = document.createElement("div");
    banner.id = "oml-mini-banner";
    banner.style.position = "fixed";
    banner.style.zIndex = "999999";
    banner.style.display = "flex";
    banner.style.alignItems = "center";
    banner.style.gap = "6px";
    banner.style.padding = "8px 10px";
    banner.style.borderRadius = "9999px";
    banner.style.boxShadow = "0 6px 18px rgba(0,0,0,0.12)";
    banner.style.backdropFilter = "blur(6px)";
    banner.style.cursor = "grab";
    banner.style.transition = "opacity .12s, transform .12s";

    if (theme === "dark") {
      banner.style.background = "rgba(18,18,18,0.88)";
      banner.style.color = "#e6e6e6";
    } else {
      banner.style.background = "rgba(255,255,255,0.95)";
      banner.style.color = "#111";
    }

    const logoWrap = document.createElement("div");
    logoWrap.innerHTML = SVG_LOGO;
    logoWrap.style.width = "18px";
    logoWrap.style.height = "18px";
    logoWrap.style.flex = "0 0 auto";
    logoWrap.style.display = "flex";
    logoWrap.style.alignItems = "center";
    logoWrap.style.justifyContent = "center";
    logoWrap.style.color = theme === "dark" ? "#BDBDBD" : "#545454";

    const insertBtn = document.createElement("button");
    insertBtn.id = "oml-insert-btn";
    insertBtn.textContent = "Insert memory";
    insertBtn.style.padding = "6px 8px";
    insertBtn.style.borderRadius = "9999px";
    insertBtn.style.border = "none";
    insertBtn.style.background = "transparent";
    insertBtn.style.cursor = "pointer";
    insertBtn.style.fontSize = "13px";
    insertBtn.style.fontWeight = "600";
    insertBtn.style.color = "inherit";
    const hoverBg = theme === "dark" ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.06)";
    insertBtn.addEventListener("mouseenter", ()=> { insertBtn.style.background = hoverBg; insertBtn.style.transform = "translateY(-1px)"; });
    insertBtn.addEventListener("mouseleave", ()=> { insertBtn.style.background = "transparent"; insertBtn.style.transform = ""; });

    const hideBtn = document.createElement("button");
    hideBtn.id = "oml-hide-btn";
    hideBtn.innerHTML = "✕";
    hideBtn.title = "Hide OML for this site (Ctrl/Cmd+O to unhide)";
    hideBtn.style.padding = "6px";
    hideBtn.style.width = "32px";
    hideBtn.style.height = "32px";
    hideBtn.style.display = "inline-flex";
    hideBtn.style.alignItems = "center";
    hideBtn.style.justifyContent = "center";
    hideBtn.style.borderRadius = "9999px";
    hideBtn.style.border = "none";
    hideBtn.style.background = "transparent";
    hideBtn.style.cursor = "pointer";
    hideBtn.style.fontWeight = "700";
    hideBtn.style.color = "inherit";
    hideBtn.addEventListener("mouseenter", ()=> { hideBtn.style.background = hoverBg; hideBtn.style.transform = "scale(1.04)"; });
    hideBtn.addEventListener("mouseleave", ()=> { hideBtn.style.background = "transparent"; hideBtn.style.transform = ""; });

    banner.appendChild(logoWrap);
    banner.appendChild(insertBtn);
    banner.appendChild(hideBtn);
    return banner;
  }

  // ---------- Selection tooltip + Quick Edit (chips) ----------
  let selectionTooltipEl = null;
  let quickEditEl = null;
  let selectionTimeout = null;
  let lastSelection = { text: '', rect: null };
  let ignoreHide = false;

  function preserveSelection() {
    const sel = window.getSelection();
    if (sel.rangeCount > 0) return sel.getRangeAt(0).cloneRange();
    return null;
  }

  function restoreSelection(range) {
    if (!range) return;
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  }

  function createSelectionTooltip(theme) {
    if (selectionTooltipEl) return selectionTooltipEl;
    const tip = document.createElement("div");
    tip.id = "__oml_selection_tooltip";
    tip.style.position = "absolute";
    tip.style.zIndex = "2147483646";
    tip.style.display = "flex";
    tip.style.alignItems = "center";
    tip.style.gap = "8px";
    tip.style.padding = "6px 8px";
    tip.style.borderRadius = "999px";
    tip.style.boxShadow = "0 6px 20px rgba(0,0,0,0.14)";
    tip.style.fontSize = "13px";
    tip.style.userSelect = "none";
    tip.style.cursor = "default";
    tip.style.transition = "opacity .12s, transform .08s";
    if (theme === "dark") {
      tip.style.background = "rgba(28,28,28,0.92)";
      tip.style.color = "#eaeaea";
    } else {
      tip.style.background = "rgba(255,255,255,0.98)";
      tip.style.color = "#111";
    }

    const saveBtn = document.createElement("button");
    saveBtn.textContent = "Save";
    saveBtn.style.padding = "6px 8px";
    saveBtn.style.borderRadius = "8px";
    saveBtn.style.border = "none";
    saveBtn.style.cursor = "pointer";
    saveBtn.style.fontWeight = "700";
    saveBtn.style.background = "transparent";
    saveBtn.style.color = "inherit";
    saveBtn.addEventListener("mouseenter", ()=> { saveBtn.style.transform = "translateY(-1px)"; });
    saveBtn.addEventListener("mouseleave", ()=> { saveBtn.style.transform = ""; });

    const cancelBtn = document.createElement("button");
    cancelBtn.textContent = "✕";
    cancelBtn.title = "Cancel";
    cancelBtn.style.padding = "6px";
    cancelBtn.style.borderRadius = "8px";
    cancelBtn.style.border = "none";
    cancelBtn.style.cursor = "pointer";
    cancelBtn.style.fontWeight = "700";
    cancelBtn.style.background = "transparent";
    cancelBtn.style.color = "inherit";

    tip.appendChild(saveBtn);
    tip.appendChild(cancelBtn);

    tip.addEventListener('mousedown', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
    });

    selectionTooltipEl = tip;
    document.body.appendChild(selectionTooltipEl);
    selectionTooltipEl.style.opacity = "0";
    return selectionTooltipEl;
  }

  function hideSelectionTooltip() {
    try {
      if (!selectionTooltipEl) return;
      selectionTooltipEl.style.opacity = "0";
      setTimeout(() => {
        if (selectionTooltipEl && selectionTooltipEl.parentElement) {
          selectionTooltipEl.style.left = "-9999px";
          selectionTooltipEl.style.top = "-9999px";
        }
      }, 160);
    } catch(e){}
  }

  function showSelectionTooltipAt(rect, theme="light") {
    try {
      if (!rect) return;
      const tip = createSelectionTooltip(theme);
      const tipRect = tip.getBoundingClientRect();
      const margin = 8;
      let left = Math.round(rect.left + (rect.width - tipRect.width)/2);
      let top = Math.round(rect.top - tipRect.height - margin);
      if (left < 6) left = 6;
      if (left + tipRect.width > window.innerWidth - 6) left = window.innerWidth - tipRect.width - 6;
      if (top < 6) {
        top = Math.round(rect.bottom + margin);
      }
      tip.style.left = `${left}px`;
      tip.style.top = `${top}px`;
      tip.style.opacity = "1";
    } catch(e){}
  }

  function getSelectionTextAndRect() {
    try {
      const active = document.activeElement;
      if (active && (active.tagName === "TEXTAREA" || (active.tagName === "INPUT" && active.type === "text"))) {
        const el = active;
        const s = el.value;
        const start = el.selectionStart || 0, end = el.selectionEnd || 0;
        const text = s.slice(start,end).trim();
        if (!text) return { text: "", rect: null };
        const r = el.getBoundingClientRect();
        return { text, rect: { left: r.left, top: r.top, bottom: r.bottom, right: r.right, width: r.width, height: r.height } };
      }

      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0) return { text: "", rect: null };
      const text = sel.toString().trim();
      if (!text) return { text: "", rect: null };
      const range = sel.getRangeAt(0).cloneRange();
      let rect = range.getBoundingClientRect();
      if (!rect || (rect.width === 0 && rect.height === 0)) {
        const container = range.commonAncestorContainer;
        const el = (container.nodeType === 1) ? container : container.parentElement;
        if (el) rect = el.getBoundingClientRect();
      }
      return { text, rect };
    } catch(e) {
      return { text: "", rect: null };
    }
  }

  function buildMetaForSelection(text) {
    const meta = {};
    try {
      meta.page_title = document.title || "";
      meta.page_url = location.href;
      meta.hostname = location.hostname;
      try {
        const sel = window.getSelection();
        if (sel && sel.rangeCount > 0) {
          const node = sel.getRangeAt(0).commonAncestorContainer;
          const el = (node && node.nodeType === 1) ? node : (node && node.parentElement) ? node.parentElement : null;
          if (el) {
            const path = [];
            let cur = el;
            let depth = 0;
            while (cur && cur.tagName && depth < 6) {
              let piece = cur.tagName.toLowerCase();
              if (cur.id) piece += `#${cur.id}`;
              else if (cur.className && typeof cur.className === "string") {
                const cls = cur.className.split(/\s+/).filter(Boolean)[0];
                if (cls) piece += `.${cls}`;
              }
              path.unshift(piece);
              cur = cur.parentElement;
              depth++;
            }
            meta.selectorHint = path.join(" > ");
          }
        }
      } catch(e){}
      meta.snippet = (text.length > 140) ? (text.slice(0,140) + "…") : text;
    } catch(e){}
    return meta;
  }

  // ---------- Quick edit (chips + input) ----------
  function createQuickEditPanel(theme) {
    if (quickEditEl) return quickEditEl;
    const panel = document.createElement("div");
    panel.id = "__oml_quick_edit";
    panel.style.position = "absolute";
    panel.style.zIndex = "2147483647";
    panel.style.width = "360px";
    panel.style.maxWidth = "calc(100% - 20px)";
    panel.style.display = "flex";
    panel.style.flexDirection = "column";
    panel.style.gap = "8px";
    panel.style.padding = "10px";
    panel.style.borderRadius = "10px";
    panel.style.boxShadow = "0 10px 30px rgba(0,0,0,0.18)";
    panel.style.fontSize = "13px";
    panel.style.userSelect = "none";
    panel.style.background = (theme === "dark") ? "rgba(18,18,18,0.95)" : "#fff";
    panel.style.color = (theme === "dark") ? "#eee" : "#111";

    panel.addEventListener('mousedown', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
    });

    // summary
    const sumLabel = document.createElement("div"); sumLabel.textContent = "Summary (short)";
    sumLabel.style.fontSize = "12px"; sumLabel.style.opacity = "0.8";
    const sumInput = document.createElement("input");
    sumInput.type = "text";
    sumInput.placeholder = "Short summary…";
    sumInput.style.padding = "8px";
    sumInput.style.borderRadius = "8px";
    sumInput.style.border = "1px solid rgba(0,0,0,0.08)";
    sumInput.style.width = "100%";
    sumInput.style.boxSizing = "border-box";
    sumInput.style.userSelect = "text";

    // suggested chips
    const suggestedLabel = document.createElement("div"); suggestedLabel.textContent = "Suggested tags";
    suggestedLabel.style.fontSize = "12px"; suggestedLabel.style.opacity = "0.8";
    const suggestedWrap = document.createElement("div");
    suggestedWrap.style.display = "flex";
    suggestedWrap.style.flexWrap = "wrap";
    suggestedWrap.style.gap = "6px";

    // custom tag input and final chips
    const tagLabel = document.createElement("div"); tagLabel.textContent = "Tags (add or edit)";
    tagLabel.style.fontSize = "12px"; tagLabel.style.opacity = "0.8";
    const tagInput = document.createElement("input");
    tagInput.type = "text";
    tagInput.placeholder = "Type a tag and press Enter";
    tagInput.style.padding = "8px";
    tagInput.style.borderRadius = "8px";
    tagInput.style.border = "1px solid rgba(0,0,0,0.08)";
    tagInput.style.width = "100%";
    tagInput.style.boxSizing = "border-box";
    tagInput.style.userSelect = "text";

    const tagChipsWrap = document.createElement("div");
    tagChipsWrap.style.display = "flex";
    tagChipsWrap.style.flexWrap = "wrap";
    tagChipsWrap.style.gap = "6px";
    tagChipsWrap.style.marginTop = "6px";

    // actions
    const row = document.createElement("div");
    row.style.display = "flex";
    row.style.justifyContent = "flex-end";
    row.style.gap = "8px";

    const cancelBtn = document.createElement("button");
    cancelBtn.textContent = "Cancel";
    cancelBtn.style.padding = "8px 10px";
    cancelBtn.style.border = "none";
    cancelBtn.style.borderRadius = "8px";
    cancelBtn.style.cursor = "pointer";
    cancelBtn.style.background = "transparent";

    const saveBtn = document.createElement("button");
    saveBtn.textContent = "Save & Close";
    saveBtn.style.padding = "8px 10px";
    saveBtn.style.border = "none";
    saveBtn.style.borderRadius = "8px";
    saveBtn.style.cursor = "pointer";
    saveBtn.style.background = "linear-gradient(90deg,#06d6a0,#118ab2)";
    saveBtn.style.color = "#fff";

    row.appendChild(cancelBtn);
    row.appendChild(saveBtn);

    panel.appendChild(sumLabel);
    panel.appendChild(sumInput);
    panel.appendChild(suggestedLabel);
    panel.appendChild(suggestedWrap);
    panel.appendChild(tagLabel);
    panel.appendChild(tagInput);
    panel.appendChild(tagChipsWrap);
    panel.appendChild(row);

    document.body.appendChild(panel);

    quickEditEl = {
      el: panel,
      nodes: { sumInput, suggestedWrap, tagInput, tagChipsWrap, cancelBtn, saveBtn },
      state: { selectedTags: new Set(), suggestedTags: [] }
    };

    function chipElement(text, opts = {}) {
      const chip = document.createElement("div");
      chip.textContent = text;
      chip.style.padding = "6px 8px";
      chip.style.borderRadius = "999px";
      chip.style.fontSize = "12px";
      chip.style.cursor = "pointer";
      chip.style.display = "inline-flex";
      chip.style.alignItems = "center";
      chip.style.gap = "8px";
      chip.style.userSelect = "none";
      chip.dataset.tag = text;
      if (opts.suggested) {
        chip.style.background = "rgba(0,0,0,0.04)";
        chip.style.color = (theme === "dark") ? "#ddd" : "#111";
      } else {
        chip.style.background = "#e8f8f2";
        chip.style.color = "#033";
        const x = document.createElement("span");
        x.textContent = "✕";
        x.style.marginLeft = "6px";
        x.style.opacity = "0.7";
        x.style.fontSize = "11px";
        x.style.cursor = "pointer";
        x.addEventListener("click", (e) => {
          e.stopPropagation();
          quickEditEl.state.selectedTags.delete(text);
          renderFinalChips();
        });
        chip.appendChild(x);
      }
      return chip;
    }

    function renderSuggested(list) {
      suggestedWrap.innerHTML = "";
      quickEditEl.state.suggestedTags = Array.isArray(list) ? list : [];
      (quickEditEl.state.suggestedTags || []).forEach(tag => {
        const c = chipElement(tag, { suggested: true });
        c.addEventListener("click", (e) => {
          e.stopPropagation();
          if (quickEditEl.state.selectedTags.has(tag)) quickEditEl.state.selectedTags.delete(tag);
          else quickEditEl.state.selectedTags.add(tag);
          renderFinalChips();
        });
        suggestedWrap.appendChild(c);
      });
    }

    function renderFinalChips() {
      tagChipsWrap.innerHTML = "";
      Array.from(quickEditEl.state.selectedTags).forEach(tag => {
        tagChipsWrap.appendChild(chipElement(tag, { suggested: false }));
      });
    }

    tagInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        const v = tagInput.value.trim();
        if (v) {
          quickEditEl.state.selectedTags.add(v);
          renderFinalChips();
          tagInput.value = "";
        }
      }
    });

    cancelBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      quickEditEl.el.style.opacity = "0";
      setTimeout(()=>{ try{ quickEditEl.el.style.left = "-9999px"; quickEditEl.el.style.top = "-9999px"; }catch(_){} }, 140);
    });

    saveBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      const summaryVal = quickEditEl.nodes.sumInput.value.trim();
      const tagsArr = Array.from(quickEditEl.state.selectedTags);
      const meta = quickEditEl.lastMeta || { page_title: document.title, page_url: location.href, hostname: location.hostname, snippet: quickEditEl.lastSnippet || "" };
      const textPayload = quickEditEl.lastSelectedText || "";
      const created_at = quickEditEl.lastCreatedAt || new Date().toISOString();
      const id = quickEditEl.lastId || uid();
      const summary = summaryVal || meta.snippet || (String(textPayload || "").slice(0,220));
      const tags = tagsArr.length ? tagsArr : undefined;
      try {
        chrome.runtime.sendMessage({
          type: 'saveSelection',
          text: textPayload,
          meta,
          tags,
          summary,
          created_at,
          id,
          confetti: true
        }, () => {});
      } catch(e) {
        // fallback to storage write
        (async () => {
          try {
            const cur = await safeStorageGet(['oml_memory']);
            const root = cur.oml_memory || { profile:{}, memory:[] };
            root.memory = root.memory || [];
            const item = {
              id,
              text: textPayload,
              summary,
              tags,
              page_title: meta.page_title || "",
              page_url: meta.page_url || "",
              source: meta.source || "quick_edit",
              created_at,
              selectorHint: meta.selectorHint || undefined,
              hostname: meta.hostname || undefined
            };
            root.memory.unshift(item);
            await safeStorageSet({ oml_memory: root });
          } catch(e){}
        })();
      }
      quickEditEl.el.style.opacity = "0";
      setTimeout(()=>{ try{ quickEditEl.el.style.left = "-9999px"; quickEditEl.el.style.top = "-9999px"; }catch(_){} }, 140);
    });

    quickEditEl.hide = function(){ try{ quickEditEl.el.style.opacity = "0"; setTimeout(()=>{ quickEditEl.el.style.left = "-9999px"; quickEditEl.el.style.top = "-9999px"; }, 140); }catch(e){} };
    quickEditEl.showAt = function(x,y, opts = {}, savedRange) {
      try {
        quickEditEl.el.style.left = `${x}px`;
        quickEditEl.el.style.top = `${y}px`;
        quickEditEl.el.style.opacity = "1";
        quickEditEl.nodes.sumInput.value = opts.summary || "";
        quickEditEl.state.selectedTags = new Set(Array.isArray(opts.prefillTags) ? opts.prefillTags : []);
        renderFinalChips();
        renderSuggested(opts.suggestions || []);
        quickEditEl.lastSelectedText = opts.selectedText || "";
        quickEditEl.lastMeta = opts.meta || {};
        quickEditEl.lastSnippet = opts.meta && opts.meta.snippet ? opts.meta.snippet : (opts.selectedText ? (opts.selectedText.slice(0,140)) : "");
        quickEditEl.lastId = opts.id || uid();
        quickEditEl.lastCreatedAt = opts.created_at || new Date().toISOString();
        quickEditEl.nodes.tagInput.value = "";
        ignoreHide = true;
        setTimeout(() => {
          quickEditEl.nodes.sumInput.focus();
          restoreSelection(savedRange);
          setTimeout(() => ignoreHide = false, 300);
        }, 10);
      } catch(e){}
    };

    return quickEditEl;
  }

  function positionQuickEditNear(rect, opts = {}, savedRange) {
    try {
      const theme = detectTheme();
      const panel = createQuickEditPanel(theme);
      const elRect = panel.el.getBoundingClientRect();
      let left = Math.round(rect.left + (rect.width - elRect.width)/2);
      let top = Math.round(rect.top - elRect.height - 10);
      if (left < 8) left = 8;
      if (left + elRect.width > window.innerWidth - 8) left = window.innerWidth - elRect.width - 8;
      if (top < 8) top = rect.bottom + 10;
      panel.showAt(left, top, opts, savedRange);
    } catch(e){}
  }

  // ---------- Banner placement - STABLE VERSION ----------
let bannerEl = null;
let currentInput = null;
let repositionHandle = null;
let userMoved = false;
let dragState = null;
let bannerVisible = false;

function positionBannerNearInput(inputEl) {
  if (!bannerEl || !inputEl || userMoved) return;
  try {
    const rect = inputEl.getBoundingClientRect();
    const bannerRect = bannerEl.getBoundingClientRect();
    
    let left = rect.left - bannerRect.width - 12;
    if (left < 6) left = rect.right + 12;
    if (left + bannerRect.width > window.innerWidth - 6) {
      left = rect.left + 6;
    }
    
    let top = rect.top + (rect.height - bannerRect.height) / 2;
    const vpH = window.innerHeight;
    
    if (top < 6) top = 6;
    if (top + bannerRect.height > vpH - 6) top = vpH - bannerRect.height - 6;
    
    bannerEl.style.left = `${Math.round(left)}px`;
    bannerEl.style.top = `${Math.round(top)}px`;
    
    if (!bannerVisible) {
      bannerEl.style.opacity = "1";
      bannerEl.style.transform = "translateY(0)";
      bannerVisible = true;
    }
  } catch (e) {
    console.error("[OML] Banner positioning error:", e);
  }
}

function removeBanner() {
  if (bannerEl && bannerEl.parentElement) {
    try {
      bannerEl.style.opacity = "0";
      setTimeout(() => {
        if (bannerEl && bannerEl.parentElement) {
          bannerEl.parentElement.removeChild(bannerEl);
        }
      }, 200);
    } catch(e) {}
  }
  bannerEl = null;
  currentInput = null;
  bannerVisible = false;
  if (repositionHandle) {
    window.removeEventListener("scroll", repositionHandle);
    window.removeEventListener("resize", repositionHandle);
    repositionHandle = null;
  }
}

const SUPPORTED_AI_HOSTS = new Set([
  'chat.openai.com',
  'chatgpt.com',
  'claude.ai',
  'gemini.google.com',
  'grok.com'
]);

async function renderMiniBanner() {
  if (ignoreHide) return;
  try {
    const s = await safeStorageGet(["oml_memory", "oml_hidden_domains"]);
    const domain = location.hostname;
    const hidden = s.oml_hidden_domains || {};
    
    if (hidden[domain]) {
      removeBanner();
      return;
    }

    // Skip banner rendering if not on supported AI host
    if (!SUPPORTED_AI_HOSTS.has(domain)) {
      removeBanner();
      return;
    }

    const theme = detectTheme();
    
    // Create banner if it doesn't exist
    if (!bannerEl) {
      bannerEl = createBannerElement(theme);
      document.body.appendChild(bannerEl);
      bannerVisible = false;

      const insertBtn = bannerEl.querySelector("#oml-insert-btn");
      const hideBtn = bannerEl.querySelector("#oml-hide-btn");

      if (insertBtn) {
        insertBtn.addEventListener("click", async (e) => {
          e.preventDefault();
          e.stopPropagation();
          
          const data = await safeStorageGet(["oml_memory"]);
          const memNow = data.oml_memory || { profile:{}, memory:[] };
          const el = findEditable();
          
          if (!el) {
            alert("OML: No input field found");
            return;
          }
          
          const query = (el.value || el.innerText || "");
          const toInsert = pickRelevant(memNow, query);
          
          if (!toInsert) {
            alert("OML: No relevant memory found");
            return;
          }
          
          await safeInsert(el, toInsert);
        });
      }

      if (hideBtn) {
        hideBtn.addEventListener("click", async (e) => {
          e.preventDefault();
          e.stopPropagation();
          
          const s2 = await safeStorageGet(["oml_hidden_domains"]);
          const hiddenNow = s2.oml_hidden_domains || {};
          hiddenNow[location.hostname] = true;
          await safeStorageSet({ oml_hidden_domains: hiddenNow });
          removeBanner();
        });
      }

      // Dragging
      bannerEl.addEventListener("mousedown", (ev) => {
        if (ev.target.tagName === "BUTTON" || ev.target.closest("button")) return;
        
        dragState = {
          startX: ev.clientX,
          startY: ev.clientY,
          left: parseFloat(bannerEl.style.left || 0),
          top: parseFloat(bannerEl.style.top || 0)
        };
        bannerEl.style.cursor = "grabbing";
        userMoved = true;
        ev.preventDefault();
      });

      window.addEventListener("mousemove", (ev) => {
        if (!dragState) return;
        
        const dx = ev.clientX - dragState.startX;
        const dy = ev.clientY - dragState.startY;
        const newLeft = Math.max(6, Math.min(window.innerWidth - bannerEl.offsetWidth - 6, dragState.left + dx));
        const newTop = Math.max(6, Math.min(window.innerHeight - bannerEl.offsetHeight - 6, dragState.top + dy));
        
        bannerEl.style.left = `${Math.round(newLeft)}px`;
        bannerEl.style.top = `${Math.round(newTop)}px`;
      });

      window.addEventListener("mouseup", () => {
        if (dragState) {
          dragState = null;
          if (bannerEl) bannerEl.style.cursor = "grab";
        }
      });
    } else {
      // Update theme if it changed
      if (theme === "dark") {
        bannerEl.style.background = "rgba(18,18,18,0.88)";
        bannerEl.style.color = "#e6e6e6";
        const logoDiv = bannerEl.querySelector("div");
        if (logoDiv) logoDiv.style.color = "#BDBDBD";
      } else {
        bannerEl.style.background = "rgba(255,255,255,0.95)";
        bannerEl.style.color = "#111";
        const logoDiv = bannerEl.querySelector("div");
        if (logoDiv) logoDiv.style.color = "#545454";
      }
    }

    // Find target input
    let target = document.activeElement;
    if (!target || !(
      target.tagName === "TEXTAREA" || 
      (target.tagName === "INPUT" && target.type === "text") || 
      target.getAttribute("contenteditable") === "true" || 
      target.getAttribute("role") === "textbox"
    )) {
      target = findEditable();
    }

    if (!target) {
      // No input found - hide banner but don't remove it
      if (bannerEl && bannerVisible) {
        bannerEl.style.opacity = "0";
        bannerEl.style.transform = "translateY(6px)";
        bannerVisible = false;
      }
      return;
    }

    currentInput = target;
    
    if (!userMoved) {
      positionBannerNearInput(target);
    } else if (!bannerVisible) {
      bannerEl.style.opacity = "1";
      bannerEl.style.transform = "translateY(0)";
      bannerVisible = true;
    }

    // Setup reposition listener
    if (!repositionHandle) {
      repositionHandle = debounce(() => {
        if (currentInput && !userMoved) {
          positionBannerNearInput(currentInput);
        }
      }, 100);
      window.addEventListener("scroll", repositionHandle, true);
      window.addEventListener("resize", repositionHandle);
    }

  } catch (e) {
    console.error("[OML] renderMiniBanner error:", e);
    setTimeout(() => {
      try {
        renderMiniBanner();
      } catch(_) {}
    }, 1000);
  }
}

  // message handler: allow popup to insert text through content script
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message) return;
    if (message.action === 'oml_insert_text') {
      (async () => {
        try {
          const el = findEditable();
          if (!el) {
            sendResponse({ ok: false, reason: 'no-editable' });
            return;
          }
          const ok = await safeInsert(el, message.text || "");
          sendResponse({ ok: !!ok });
        } catch (e) {
          sendResponse({ ok: false, reason: String(e) });
        }
      })();
      return true;
    }
  });

  // ---------- Selection handling (Shift+Save -> Quick Edit) ----------
  const MIN_SELECTION_LENGTH = 6;
  const selectionHandler = debounce(async () => {
    try {
      const { text, rect } = getSelectionTextAndRect();
      if (!text || text.length < MIN_SELECTION_LENGTH) { hideSelectionTooltip(); return; }
      const active = document.activeElement;
      if (active && active.id && (active.id.indexOf('__oml') === 0 || active.id === 'oml-mini-banner')) { hideSelectionTooltip(); return; }
      lastSelection = { text, rect };
      const theme = detectTheme();
      showSelectionTooltipAt(rect, theme);
      const tip = createSelectionTooltip(theme);
      const saveBtn = tip.querySelector("button:nth-child(1)");
      const cancelBtn = tip.querySelector("button:nth-child(2)");

      // avoid duplicate handlers
      const newSave = saveBtn.cloneNode(true);
      const newCancel = cancelBtn.cloneNode(true);
      tip.replaceChild(newSave, saveBtn);
      tip.replaceChild(newCancel, cancelBtn);

      newSave.addEventListener("click", async (ev) => {
        ev.stopPropagation();
        const savedRange = preserveSelection();
        hideSelectionTooltip();
        const payloadText = lastSelection.text;
        const currentRect = lastSelection.rect;
        if (!payloadText.trim()) return;
        const meta = buildMetaForSelection(payloadText);
        const suggested = inferTagsLocal(payloadText, 4);
        const shift = !!ev.shiftKey;
        if (shift) {
          positionQuickEditNear(currentRect, { suggestions: suggested, prefillTags: suggested, summary: meta.snippet, selectedText: payloadText, meta, id: uid(), created_at: new Date().toISOString() }, savedRange);
          return;
        }
        // direct save with inferred tags
        try {
          chrome.runtime.sendMessage({
            type: 'saveSelection',
            text: payloadText,
            meta,
            tags: suggested.length ? suggested : undefined,
            summary: meta.snippet,
            confetti: true
          }, ()=>{});
        } catch (err) {
          // fallback write
          try {
            const cur = await safeStorageGet(['oml_memory']);
            const root = cur.oml_memory || { profile:{}, memory:[] };
            root.memory = root.memory || [];
            const item = {
              id: uid(),
              text: payloadText,
              summary: meta.snippet,
              tags: suggested.length ? suggested : undefined,
              page_title: meta.page_title || "",
              page_url: meta.page_url || "",
              source: "direct_save",
              created_at: new Date().toISOString(),
              selectorHint: meta.selectorHint || undefined,
              hostname: meta.hostname || undefined
            };
            root.memory.unshift(item);
            await safeStorageSet({ oml_memory: root });
          } catch(e){}
        }
        lastSelection = { text: '', rect: null };
      });

      newCancel.addEventListener("click", (ev) => {
        ev.stopPropagation();
        hideSelectionTooltip();
        try { const sel = window.getSelection(); if (sel) sel.removeAllRanges(); } catch(e){}
        lastSelection = { text: '', rect: null };
      });
    } catch (e) {
      hideSelectionTooltip();
      lastSelection = { text: '', rect: null };
    }
  }, 90);

  const hideOnScrollResize = debounce(() => {
    if (ignoreHide) return;
    hideSelectionTooltip();
    if (quickEditEl && quickEditEl.el) quickEditEl.hide();
    lastSelection = { text: '', rect: null };
  }, 60);

  document.addEventListener("selectionchange", () => {
    if (selectionTimeout) clearTimeout(selectionTimeout);
    selectionTimeout = setTimeout(() => selectionHandler(), 60);
  }, true);

  document.addEventListener("mouseup", () => {
    if (selectionTimeout) clearTimeout(selectionTimeout);
    selectionTimeout = setTimeout(() => selectionHandler(), 60);
  }, true);

  window.addEventListener("scroll", hideOnScrollResize, true);
  window.addEventListener("resize", hideOnScrollResize);

  document.addEventListener("mousedown", (ev) => {
    if (ignoreHide) return;
    const tip = selectionTooltipEl;
    if (!tip) return;
    if (ev.target && tip.contains(ev.target)) return;
    const banner = document.getElementById("oml-mini-banner");
    if (banner && banner.contains(ev.target)) return;
    if (quickEditEl && quickEditEl.el && quickEditEl.el.contains(ev.target)) return;
    hideSelectionTooltip();
    if (quickEditEl && quickEditEl.el) quickEditEl.hide();
    lastSelection = { text: '', rect: null };
  }, true);

  // ========== HOTKEY HANDLER (Ctrl/Cmd+O) ==========
async function handleHotkey(e) {
  const isMac = navigator.platform.toUpperCase().indexOf("MAC") >= 0;
  const ctrlOk = isMac ? e.metaKey && !e.ctrlKey : e.ctrlKey;
  
  if (!ctrlOk || !e.key || e.key.toLowerCase() !== "o") {
    return;
  }
  
  e.preventDefault();
  
  try {
    const domain = location.hostname;
    const s = await safeStorageGet(["oml_hidden_domains", "oml_memory"]);
    const hidden = s.oml_hidden_domains || {};
    
    // If OML is hidden on this site, unhide it
    if (hidden[domain]) {
      delete hidden[domain];
      await safeStorageSet({ oml_hidden_domains: hidden });
      userMoved = false;
      renderMiniBanner();
      console.log("[OML] Unhidden on this site");
      return;
    }
    
    // Otherwise, try to insert memory
    const mem = s.oml_memory || { profile: {}, memory: [] };
    const el = findEditable();
    
    if (!el) {
      alert("OML: No input field found");
      return;
    }
    
    const query = (el.value || el.innerText || "");
    const toInsert = pickRelevant(mem, query);
    
    if (!toInsert) {
      alert("OML: No relevant memory to insert");
      return;
    }
    
    await safeInsert(el, toInsert);
    console.log("[OML] Inserted via hotkey");
    
  } catch (e) {
    console.error("[OML] Hotkey handler error:", e);
  }
}

// Attach hotkey listener
document.addEventListener("keydown", handleHotkey, true);
console.log("[OML] Hotkey handler attached (Ctrl/Cmd+O)");

  // observers
  const debouncedRender = debounce(renderMiniBanner, 180);
  const mo = new MutationObserver(debouncedRender);
  try { mo.observe(document.documentElement || document.body, { childList:true, subtree:true }); } catch(e){}
  document.addEventListener("keydown", handleHotkey, true);
  try { chrome.storage.onChanged.addListener((changes, area) => { if (area === "local" && (changes.oml_memory || changes.oml_hidden_domains)) debouncedRender(); }); } catch(e){}

  debouncedRender();
  let tries = 0;
  const poll = setInterval(()=>{ debouncedRender(); tries++; if (tries>40) clearInterval(poll); }, 150);

})();
