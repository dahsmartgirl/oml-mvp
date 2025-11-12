// background.js
// Full replacement: tagging-enabled save handlers + accepts rich metadata from content script,
// preserves getMemory/updateMemory handlers, context menu registration (defensive).
// Also injects top-center toast with confetti animation when requested.

// ---------- small logging helpers ----------
function log(...args){ try{ console.log("[OML background]", ...args); }catch(e){} }
function warn(...args){ try{ console.warn("[OML background]", ...args); }catch(e){} }
function fail(...args){ try{ console.error("[OML background]", ...args); }catch(e){} }

// ---------- simple tagger (keyword-based) ----------
const TAG_KEYWORDS = {
  project: ["project","build","product","app","extension","mvp","prototype","feature","launch"],
  ai: ["ai","llm","gpt","claude","gemini","model","embedding","inference","prompt"],
  design: ["design","ux","ui","prototype","wireframe","interface","visual","usability","ux/ui"],
  personal: ["i","my","me","personally","i'm","i am","goal","aspire","joined","born"],
  goal: ["goal","goals","plan","target","aim","aspire","objective"],
  education: ["school","university","college","degree","scholarship","hult","study","graduate"],
  product: ["product","users","growth","market","metrics","startup","scale"],
  privacy: ["privacy","data","consent","policy","gdpr","permission","secure"],
  sync: ["sync","cloud","syncing","backup","drive","firebase","supabase","google"],
  memory: ["memory","store","memories","tag","context","insert","save"],
  code: ["code","javascript","react","typescript","python","repo","github","open source","open-source"],
  research: ["research","paper","study","analysis","findings"],
  health: ["health","mental","therapy","wellness","haven","rant"]
};

function tokenizeForTagging(text = "") {
  try { return text.toLowerCase().split(/\W+/).filter(Boolean); } catch (e) { return []; }
}

function inferTagsFromText(text = "", max = 3) {
  try {
    const tokens = tokenizeForTagging(String(text || ""));
    if (!tokens.length) return [];
    const scores = {};
    for (const [tag, keywords] of Object.entries(TAG_KEYWORDS)) {
      let s = 0;
      for (const kw of keywords) {
        if (kw.indexOf(" ") >= 0) {
          if (text.toLowerCase().indexOf(kw) !== -1) s += 2;
        } else {
          tokens.forEach(t => { if (t === kw) s += 1; });
        }
      }
      if (s > 0) scores[tag] = s;
    }
    const sorted = Object.entries(scores).sort((a,b) => b[1] - a[1]).map(x => x[0]);
    return sorted.slice(0, max);
  } catch (e) {
    return [];
  }
}

// ---------- helpers ----------
function makeId(){ return 'm_' + Date.now() + '_' + Math.random().toString(36).slice(2,8); }

function toMemoryObjectFromPayload(payload = {}) {
  // payload expected: { text, meta: {page_url, page_title, selectorHint, hostname, snippet}, tags, summary }
  const text = String(payload.text || "");
  const summary = (payload.summary && payload.summary.trim()) ? payload.summary.trim() : (text.length > 220 ? text.slice(0,220) + "…" : text);
  const created_at = payload.created_at || (new Date()).toISOString();
  const id = payload.id || makeId();
  const page_url = (payload.meta && payload.meta.page_url) ? payload.meta.page_url : (payload.page_url || "");
  const page_title = (payload.meta && payload.meta.page_title) ? payload.meta.page_title : (payload.page_title || "");
  const source = (payload.meta && payload.meta.source) ? payload.meta.source : (payload.source || "page_save");
  const tags = Array.isArray(payload.tags) && payload.tags.length ? payload.tags : inferTagsFromText(text, 3);
  return {
    id,
    text,
    summary,
    tags,
    page_title,
    page_url,
    source,
    created_at,
    // optionally keep selector hint/snippet for better UI/context
    selectorHint: payload.meta && payload.meta.selectorHint ? payload.meta.selectorHint : undefined,
    snippet: payload.meta && payload.meta.snippet ? payload.meta.snippet : undefined,
    hostname: payload.meta && payload.meta.hostname ? payload.meta.hostname : undefined
  };
}

// ---------- storage helpers ----------
function readMemoryRoot() {
  return new Promise((resolve) => {
    try {
      chrome.storage.local.get(['oml_memory'], (res) => {
        const root = (res && res.oml_memory) ? res.oml_memory : { profile: {}, memory: [] };
        root.memory = Array.isArray(root.memory) ? root.memory : [];
        resolve(root);
      });
    } catch (e) { resolve({ profile: {}, memory: [] }); }
  });
}

function writeMemoryRoot(root) {
  return new Promise((resolve) => {
    try { chrome.storage.local.set({ oml_memory: root }, () => resolve()); } catch (e) { resolve(); }
  });
}

async function saveMemoryObject(structured) {
  try {
    const root = await readMemoryRoot();
    root.memory = root.memory || [];
    const existsIdx = root.memory.findIndex(m => String(m.text || "") === String(structured.text || "") && (m.page_url || "") === (structured.page_url || ""));
    if (existsIdx >= 0) {
      const existing = root.memory[existsIdx];
      existing.created_at = structured.created_at || existing.created_at;
      existing.tags = Array.from(new Set([...(existing.tags||[]), ...(structured.tags||[])]));
      existing.summary = structured.summary || existing.summary;
      // merge snippet/selectorHint if present
      if (structured.selectorHint) existing.selectorHint = structured.selectorHint;
      if (structured.snippet) existing.snippet = structured.snippet;
      root.memory.splice(existsIdx, 1);
      root.memory.unshift(existing);
    } else {
      root.memory.unshift(structured);
      if (root.memory.length > 5000) root.memory = root.memory.slice(0,5000);
    }
    await writeMemoryRoot(root);
    return root;
  } catch (e) {
    warn("saveMemoryObject failed:", e && e.message ? e.message : e);
    return null;
  }
}

// ---------- toast + confetti injection ----------
function injectToastWithConfetti(tabId, message = "Saved to OML", doConfetti = true) {
  if (!tabId) return;
  if (!chrome || !chrome.scripting || typeof chrome.scripting.executeScript !== "function") return;
  try {
    chrome.scripting.executeScript({
      target: { tabId },
      func: (msg, confettiFlag) => {
        try {
          const ID = "__oml_toast_confetti";
          // remove existing if present
          const prev = document.getElementById(ID);
          if (prev) prev.remove();

          // container top-center
          const container = document.createElement("div");
          container.id = ID;
          Object.assign(container.style, {
            position: "fixed",
            top: "12px",
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 2147483647,
            pointerEvents: "none",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: "8px"
          });

          // toast element
          const toast = document.createElement("div");
          toast.textContent = msg;
          Object.assign(toast.style, {
            background: "rgba(18,18,18,0.94)",
            color: "#fff",
            padding: "10px 14px",
            borderRadius: "12px",
            fontSize: "13px",
            boxShadow: "0 8px 30px rgba(0,0,0,0.25)",
            opacity: "0",
            transform: "translateY(-8px)",
            transition: "opacity .18s ease, transform .18s ease",
            pointerEvents: "auto"
          });

          // confetti layer (canvas-like using divs)
          const confettiLayer = document.createElement("div");
          Object.assign(confettiLayer.style, {
            position: "relative",
            width: "240px",
            height: "0px",
            overflow: "visible",
            pointerEvents: "none"
          });

          container.appendChild(confettiLayer);
          container.appendChild(toast);
          document.body.appendChild(container);

          // animate toast in
          requestAnimationFrame(() => {
            toast.style.opacity = "1";
            toast.style.transform = "translateY(0)";
          });

          // simple confetti burst using small divs with CSS animations
          if (confettiFlag) {
            const colors = ["#ef476f","#ffd166","#06d6a0","#118ab2","#073b4c","#f94144","#f8961e","#90be6d"];
            const pieces = 28;
            for (let i=0;i<pieces;i++) {
              const piece = document.createElement("div");
              const size = Math.floor(Math.random()*7) + 6;
              const left = 120; // center of 240px
              const angle = (Math.random() * 140) - 70; // -70 .. 70 degrees
              const distance = 120 + Math.random()*140;
              const rot = Math.floor(Math.random()*360);
              piece.style.position = "absolute";
              piece.style.left = `${left}px`;
              piece.style.top = `0px`;
              piece.style.width = `${size}px`;
              piece.style.height = `${size*0.65}px`;
              piece.style.background = colors[Math.floor(Math.random()*colors.length)];
              piece.style.borderRadius = "2px";
              piece.style.opacity = "0.95";
              piece.style.transform = `translate3d(0,0,0) rotate(${rot}deg)`;
              piece.style.willChange = "transform, opacity";
              // random animation duration and delay
              const dur = 800 + Math.random()*900;
              const delay = Math.random()*60;
              piece.style.transition = `transform ${dur}ms cubic-bezier(.2,.8,.2,1) ${delay}ms, opacity ${dur}ms linear ${delay}ms`;
              confettiLayer.appendChild(piece);
              // compute destination
              const rad = angle * (Math.PI/180);
              const dx = Math.cos(rad) * distance * (Math.random()*0.9 + 0.6);
              const dy = Math.sin(rad) * distance * (Math.random()*0.6 + 0.8) + 40;
              // small timeout to trigger transition
              (function(p, tx, ty, d) {
                setTimeout(() => {
                  p.style.transform = `translate3d(${tx}px, ${ty}px, 0) rotate(${rot + 360}deg)`;
                  p.style.opacity = "0";
                }, 30);
                // remove after animation
                setTimeout(() => { try{ p.remove(); } catch(e){} }, d + 300);
              })(piece, dx - left, dy, dur + delay);
            }
          }

          // auto-hide toast after 1.6s
          setTimeout(() => {
            toast.style.opacity = "0";
            toast.style.transform = "translateY(-8px)";
            setTimeout(() => { try { container.remove(); } catch(e) {} }, 240);
          }, 1600);
        } catch (e) {
          // swallow
        }
      },
      args: [message, doConfetti]
    }).catch((e) => { /* ignore */ });
  } catch (e) { /* ignore */ }
}

// ---------- context menu creation (defensive) ----------
async function ensureContextMenu() {
  try {
    if (!chrome || !chrome.contextMenus) {
      warn("chrome.contextMenus unavailable - cannot create context menu.");
      return false;
    }
    if (typeof chrome.contextMenus.removeAll === "function") {
      try { chrome.contextMenus.removeAll(); } catch(e){}
    }
    chrome.contextMenus.create({
      id: "oml-save-selection",
      title: "Save selection to OML",
      contexts: ["selection"]
    }, () => {
      if (chrome.runtime.lastError) warn("contextMenus.create error:", chrome.runtime.lastError && chrome.runtime.lastError.message);
      else log("context menu created: 'oml-save-selection'");
    });
    return true;
  } catch (e) {
    warn("ensureContextMenu threw:", e && e.message ? e.message : e);
    return false;
  }
}

try { ensureContextMenu(); } catch(e){ warn("initial ensureContextMenu failed:", e && e.message ? e.message : e); }
try {
  if (chrome && chrome.runtime && typeof chrome.runtime.onInstalled !== "undefined") chrome.runtime.onInstalled.addListener(()=>ensureContextMenu().catch(()=>{}));
  if (chrome && chrome.runtime && typeof chrome.runtime.onStartup !== "undefined") chrome.runtime.onStartup.addListener(()=>ensureContextMenu().catch(()=>{}));
} catch (e) { /* ignore */ }

// ---------- context menu handler ----------
try {
  if (chrome && chrome.contextMenus && chrome.contextMenus.onClicked && typeof chrome.contextMenus.onClicked.addListener === "function") {
    chrome.contextMenus.onClicked.addListener(async (info, tab) => {
      try {
        if (!info || info.menuItemId !== "oml-save-selection") return;
        const selectionText = (info.selectionText || "").trim();
        if (!selectionText) { if (tab && tab.id) injectToastWithConfetti(tab.id, "OML: nothing selected", false); return; }
        const meta = { page_url: (tab && tab.url) || info.pageUrl || "", page_title: (tab && tab.title) || info.pageTitle || "", hostname: (tab && tab.url) ? (new URL(tab.url)).hostname : "" };
        const mem = toMemoryObjectFromPayload({ text: selectionText, meta, source: "context_menu" });
        await saveMemoryObject(mem);
        if (tab && tab.id) injectToastWithConfetti(tab.id, "Saved to OML", true);
      } catch (e) { warn("contextMenus.onClicked error:", e && e.message ? e.message : e); }
    });
    log("contextMenus.onClicked listener attached");
  } else {
    warn("contextMenus.onClicked unavailable; message fallback active.");
  }
} catch(e) { warn("attaching contextMenus.onClicked threw:", e && e.message ? e.message : e); }

// ---------- runtime messages (rich saveSelection accepted) ----------
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  try {
    if (!message) return;
    // Accept either: { type: 'saveSelection', text } OR
    // { type: 'saveSelection', text, meta: {...}, tags: [...], summary: '...', confetti: true }
    if (message && message.type === 'saveSelection') {
      const text = (message.text || "").trim();
      if (!text) {
        if (sender && sender.tab && sender.tab.id) injectToastWithConfetti(sender.tab.id, "OML: nothing selected", false);
        if (typeof sendResponse === "function") sendResponse({ ok:false, reason:"empty" });
        return true;
      }
      const payload = {
        text,
        meta: message.meta || {},
        tags: Array.isArray(message.tags) ? message.tags : undefined,
        summary: (message.summary && String(message.summary).trim()) ? String(message.summary).trim() : undefined,
        created_at: message.created_at || undefined,
        source: (message.meta && message.meta.source) ? message.meta.source : (message.source || "message_save")
      };
      const mem = toMemoryObjectFromPayload(payload);
      saveMemoryObject(mem).then((root) => {
        // show toast + confetti if requested
        const conf = !!message.confetti;
        if (sender && sender.tab && sender.tab.id) injectToastWithConfetti(sender.tab.id, "Saved to OML", conf);
        if (typeof sendResponse === "function") sendResponse({ ok:true, memory: root });
      }).catch((e) => {
        warn("saveMemoryObject failed (message path):", e && e.message ? e.message : e);
        if (typeof sendResponse === "function") sendResponse({ ok:false, reason:"save_failed" });
      });
      return true; // async
    }

    if (message && message.type === 'getMemory') {
      chrome.storage.local.get(['oml_memory'], res => {
        if (typeof sendResponse === "function") sendResponse({ memory: res.oml_memory || null });
      });
      return true;
    }

    if (message && message.type === 'updateMemory') {
      chrome.storage.local.get(['oml_memory'], res => {
        const cur = res.oml_memory || { profile:{}, memory: [] };
        const patch = message.patch || {};
        try {
          const combined = [...(patch.memory || []), ...(cur.memory || [])];
          const dedup = [];
          const seen = new Set();
          for (const item of combined) {
            const id = (item && item.id) ? item.id : null;
            const key = id ? `id:${id}` : `txt:${String(item && (item.text||item)).slice(0,200)}|url:${String(item && item.page_url||"")}`;
            if (!seen.has(key)) { seen.add(key); dedup.push(item); }
          }
          const mergedProfile = Object.assign({}, cur.profile || {}, patch.profile || {});
          const next = { profile: mergedProfile, memory: dedup };
          chrome.storage.local.set({ oml_memory: next }, () => {
            if (typeof sendResponse === "function") sendResponse({ ok:true, memory: next });
          });
        } catch (e) {
          warn("updateMemory merge error:", e && e.message ? e.message : e);
          if (typeof sendResponse === "function") sendResponse({ ok:false, reason:"merge_error" });
        }
      });
      return true;
    }
  } catch (e) {
    warn("runtime.onMessage top-level error:", e && e.message ? e.message : e);
  }
});

chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === 'install') {
    // First-time install
    const sample = {
      profile: {},
      memory: [
        {
          id: 'm_sample_1',
          text: 'I prefer concise explanations over verbose ones',
          summary: 'Prefers concise explanations',
          tags: ['personal', 'preference'],
          page_title: 'OML Sample',
          page_url: '',
          source: 'sample',
          created_at: new Date().toISOString()
        },
        {
          id: 'm_sample_2',
          text: 'I am learning to code and building browser extensions',
          summary: 'Learning to code, building extensions',
          tags: ['personal', 'code'],
          page_title: 'OML Sample',
          page_url: '',
          source: 'sample',
          created_at: new Date().toISOString()
        }
      ]
    };
    
    chrome.storage.local.set({ oml_memory: sample });
  }
});

log("background service initialized — rich save + confetti ready");
