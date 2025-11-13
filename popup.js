// popup.js (full replacement) - structured memory UI with search, tag filter, edit/delete, copy/insert
// Preserves upload/refresh/clear flows and uses oml_memory root object: { profile:{}, memory: [...] }

function storageGet(keys) {
  return new Promise((res) => {
    try { chrome.storage.local.get(keys, r => res(r)); } catch(e) { res({}); }
  });
}
function storageSet(obj) {
  return new Promise((res) => {
    try { chrome.storage.local.set(obj, () => res()); } catch(e){ res(); }
  });
}

function escapeHtml(s=""){ return String(s).replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;"); }
function formatDate(iso) {
  try { const d = new Date(iso); return d.toLocaleString(); } catch(e){ return iso || ""; }
}

// try sending insertion request to the active tab (contentScript listens for 'oml_insert_text')
async function trySendInsertToActiveTab(text) {
  return new Promise((resolve) => {
    chrome.tabs.query({active:true, currentWindow:true}, (tabs) => {
      if (!tabs || !tabs[0]) return resolve({ ok:false, reason: 'no-active-tab' });
      const tabId = tabs[0].id;
      chrome.tabs.sendMessage(tabId, { action: 'oml_insert_text', text }, (resp) => {
        if (chrome.runtime.lastError) {
          return resolve({ ok:false, reason: 'no-listener' });
        }
        resolve({ ok: !!(resp && resp.ok) });
      });
    });
  });
}

// build set of unique tags from memory list
function collectTags(memoryArr) {
  const s = new Set();
  (memoryArr || []).forEach(m => {
    if (!m) return;
    const tags = Array.isArray(m.tags) ? m.tags : [];
    tags.forEach(t => { if (t) s.add(String(t)); });
  });
  return Array.from(s).sort();
}

async function render(filterQuery = "", filterTag = "") {
  const all = await storageGet(["oml_memory"]);
  const memObj = all.oml_memory || { profile:{}, memory:[] };
  const p = memObj.profile || {};
  const memoryRaw = Array.isArray(memObj.memory) ? memObj.memory : [];

  // container elements (assumes popup.html has these ids)
  const profileBody = document.getElementById("profileBody");
  const memSummary = document.getElementById("memSummary");
  const memList = document.getElementById("memList");
  const tagsSelect = document.getElementById("tagFilter");
  const searchInput = document.getElementById("search");

  // render profile brief
  if (profileBody) {
    profileBody.innerHTML = `
      <div><strong>${escapeHtml(p.name || p.displayName || '')}</strong> ${p.role ? `• ${escapeHtml(p.role)}` : ''}</div>
      <div style="margin-top:6px;color:#555">${escapeHtml(p.description || p.about || '')}</div>
      <div style="margin-top:6px;color:#555;font-size:12px">${p.location ? escapeHtml(p.location) : ''}</div>
    `;
  }

  // filter memory list
  let filtered = memoryRaw.slice();
  if (filterQuery && filterQuery.trim()) {
    const q = filterQuery.toLowerCase();
    filtered = filtered.filter(m => {
      const txt = (m && (m.text || m.summary || "")).toLowerCase();
      const title = (m && (m.page_title || "")).toLowerCase();
      const tags = (m && Array.isArray(m.tags) ? m.tags.join(" ").toLowerCase() : "");
      return txt.indexOf(q) !== -1 || title.indexOf(q) !== -1 || tags.indexOf(q) !== -1;
    });
  }
  if (filterTag && filterTag.trim()) {
    filtered = filtered.filter(m => Array.isArray(m.tags) && m.tags.includes(filterTag));
  }

  // render tags select
  if (tagsSelect) {
    const allTags = collectTags(memoryRaw);
    tagsSelect.innerHTML = `<option value="">All tags</option>` + allTags.map(t => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`).join("");
    if (filterTag) tagsSelect.value = filterTag;
  }

  // render summary/title
  if (memSummary) memSummary.textContent = `Memories (${filtered.length})`;

  // render list
  if (!memList) return;
  memList.innerHTML = "";
  if (!filtered.length) {
    memList.innerHTML = "<div style='padding:8px;color:#666'>No memories found.</div>";
    return;
  }

  filtered.forEach((m, i) => {
    const row = document.createElement("div");
    row.className = "mem-item";
    row.style.display = "flex";
    row.style.flexDirection = "column";
    row.style.gap = "6px";
    row.style.padding = "8px";
    row.style.borderBottom = "1px solid #eee";

    // top row: text + actions
    const top = document.createElement("div");
    top.style.display = "flex";
    top.style.justifyContent = "space-between";
    top.style.alignItems = "flex-start";
    top.style.gap = "8px";

    const left = document.createElement("div");
    left.style.flex = "1 1 auto";
    left.style.minWidth = "0";

    const txt = document.createElement("div");
    txt.className = "mem-text";
    txt.style.fontSize = "13px";
    txt.style.lineHeight = "1.25";
    txt.innerHTML = escapeHtml(m.summary || (m.text && m.text.slice(0,300)) || "");

    const meta = document.createElement("div");
    meta.style.fontSize = "12px";
    meta.style.color = "#666";
    meta.style.marginTop = "6px";
    const link = m.page_url ? `<a href="${escapeHtml(m.page_url)}" target="_blank" rel="noopener" style="color:inherit;text-decoration:underline">${escapeHtml(m.page_title || m.page_url)}</a>` : '';
    meta.innerHTML = `${link} ${m.created_at ? ` • ${escapeHtml(formatDate(m.created_at))}` : ''} ${m.source ? ` • ${escapeHtml(m.source)}` : ''}`;

    left.appendChild(txt);
    left.appendChild(meta);

    const right = document.createElement("div");
    right.style.display = "flex";
    right.style.flexDirection = "column";
    right.style.gap = "6px";
    right.style.marginLeft = "8px";

    const btnRow = document.createElement("div");
    btnRow.style.display = "flex";
    btnRow.style.gap = "6px";

    const copyBtn = document.createElement("button");
    copyBtn.textContent = "Copy";
    copyBtn.title = "Copy full memory text";
    copyBtn.style.padding = "6px 8px";
    copyBtn.style.border = "none";
    copyBtn.style.borderRadius = "6px";
    copyBtn.style.cursor = "pointer";
    copyBtn.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(String(m.text || ""));
        showStatus("Copied memory to clipboard.");
      } catch (e) {
        showStatus("Copy failed.");
      }
    });

    const insertBtn = document.createElement("button");
    insertBtn.textContent = "Insert";
    insertBtn.title = "Insert context into active chat input (falls back to clipboard)";
    insertBtn.style.padding = "6px 8px";
    insertBtn.style.border = "none";
    insertBtn.style.borderRadius = "6px";
    insertBtn.style.cursor = "pointer";
    insertBtn.addEventListener("click", async () => {
      const resp = await trySendInsertToActiveTab(String(m.text || ""));
      if (resp.ok) showStatus("Inserted into page.");
      else {
        try {
          await navigator.clipboard.writeText(String(m.text || ""));
          showStatus("No page handler — copied to clipboard (paste to insert).");
        } catch (e) {
          showStatus("Insert failed.");
        }
      }
    });

    const editBtn = document.createElement("button");
    editBtn.textContent = "Edit";
    editBtn.title = "Edit tags / summary";
    editBtn.style.padding = "6px 8px";
    editBtn.style.border = "none";
    editBtn.style.borderRadius = "6px";
    editBtn.style.cursor = "pointer";
    editBtn.addEventListener("click", () => {
      // prompt to edit tags (comma separated) and summary
      const currentTags = Array.isArray(m.tags) ? m.tags.join(", ") : "";
      const newTags = prompt("Edit tags (comma separated):", currentTags);
      if (newTags === null) return;
      const newTagsArr = newTags.split(",").map(s => s.trim()).filter(Boolean);
      const newSummary = prompt("Edit quick summary (short):", m.summary || "");
      // update storage
      updateMemoryItem(Object.assign({}, m, { tags: newTagsArr, summary: newSummary || m.summary }));
    });

    const delBtn = document.createElement("button");
    delBtn.textContent = "Delete";
    delBtn.title = "Delete this memory";
    delBtn.style.padding = "6px 8px";
    delBtn.style.border = "none";
    delBtn.style.borderRadius = "6px";
    delBtn.style.cursor = "pointer";
    delBtn.addEventListener("click", async () => {
      if (!confirm("Delete this memory?")) return;
      await deleteMemoryById(m.id);
      showStatus("Memory deleted.");
      render(searchInput ? searchInput.value : "", tagsSelect ? tagsSelect.value : "");
    });

    btnRow.appendChild(copyBtn);
    btnRow.appendChild(insertBtn);
    btnRow.appendChild(editBtn);
    btnRow.appendChild(delBtn);
    right.appendChild(btnRow);

    top.appendChild(left);
    top.appendChild(right);

    // tags row
    const tagsRow = document.createElement("div");
    tagsRow.style.display = "flex";
    tagsRow.style.gap = "6px";
    tagsRow.style.flexWrap = "wrap";
    tagsRow.style.marginTop = "6px";
    (Array.isArray(m.tags) ? m.tags : []).forEach(tag => {
      const b = document.createElement("div");
      b.textContent = String(tag);
      b.style.padding = "4px 8px";
      b.style.borderRadius = "999px";
      b.style.background = "#f0f0f0";
      b.style.fontSize = "12px";
      b.style.cursor = "pointer";
      b.addEventListener("click", () => {
        // filter by clicked tag
        if (tagsSelect) {
          tagsSelect.value = tag;
        }
        render(searchInput ? searchInput.value : "", tag);
      });
      tagsRow.appendChild(b);
    });

    row.appendChild(top);
    row.appendChild(tagsRow);
    memList.appendChild(row);
  });
}

function showStatus(msg = "") {
  const s = document.getElementById("status");
  if (!s) return;
  s.textContent = msg;
  setTimeout(() => { s.textContent = ""; }, 2000);
}

async function updateMemoryItem(newItem) {
  const all = await storageGet(['oml_memory']);
  const root = all.oml_memory || { profile:{}, memory:[] };
  root.memory = root.memory || [];
  const idx = root.memory.findIndex(x => x && x.id === newItem.id);
  if (idx >= 0) {
    root.memory[idx] = newItem;
    await storageSet({ oml_memory: root });
  } else {
    // insert if missing
    root.memory.unshift(newItem);
    await storageSet({ oml_memory: root });
  }
}

async function deleteMemoryById(id) {
  const all = await storageGet(['oml_memory']);
  const root = all.oml_memory || { profile:{}, memory:[] };
  root.memory = (root.memory || []).filter(m => !(m && m.id === id));
  await storageSet({ oml_memory: root });
}

document.addEventListener("DOMContentLoaded", () => {
  // ensure popup.html contains these elements:
  // #file (input type=file), #upload (button), #refresh, #clear, #profileBody, #memSummary, #memList, #search, #tagFilter, #status
  const uploadBtn = document.getElementById("upload");
  const fileInput = document.getElementById("file");
  const refreshBtn = document.getElementById("refresh");
  const clearBtn = document.getElementById("clear");
  const searchInput = document.getElementById("search");
  const tagFilter = document.getElementById("tagFilter");

  // search handler
  if (searchInput) {
    let t;
    searchInput.addEventListener("input", () => {
      clearTimeout(t);
      t = setTimeout(() => {
        render(searchInput.value || "", tagFilter ? tagFilter.value : "");
      }, 180);
    });
  }

  if (tagFilter) {
    tagFilter.addEventListener("change", () => {
      render(searchInput ? searchInput.value : "", tagFilter.value);
    });
  }

  // Upload handler - FIXED TO MERGE NOT REPLACE
if (uploadBtn && fileInput) {
  uploadBtn.addEventListener("click", async () => {
    const f = fileInput.files[0];
    if (!f) { 
      showStatus("⚠ Choose a file first");
      return; 
    }
    try {
      if (typeof parseExportFile !== "function") {
        showStatus("✗ Parser not found");
        return;
      }
      
      const parsed = await parseExportFile(f);
      const canonical = { profile: parsed.profile || {}, memory: [] };
      const rawMem = Array.isArray(parsed.memory) ? parsed.memory : [];
      
      for (const r of rawMem) {
        canonical.memory.push((typeof r === "string") ? { text: r } : r);
      }
      
      const converted = canonical.memory.map(item => {
        return {
          id: item.id || ('m_imp_'+Date.now()+'_'+Math.random().toString(36).slice(2,6)),
          text: item.text || item.summary || String(item || ""),
          summary: item.summary || (item.text && item.text.slice(0,220)) || "",
          tags: Array.isArray(item.tags) ? item.tags : [],
          page_title: item.page_title || item.source || "Import",
          page_url: item.page_url || "",
          source: item.source || "import",
          created_at: item.created_at || new Date().toISOString()
        };
      });
      
      // GET EXISTING DATA FIRST - DON'T ERASE IT
      const existing = await storageGet(['oml_memory']);
      const existingRoot = existing.oml_memory || { profile: {}, memory: [] };
      
      // MERGE profiles (new data overwrites old)
      const mergedProfile = Object.assign({}, existingRoot.profile || {}, canonical.profile || {});
      
      // MERGE memories - deduplicate by text content
      const existingMemories = Array.isArray(existingRoot.memory) ? existingRoot.memory : [];
      const allMemories = [...existingMemories, ...converted];
      
      // Deduplicate by text content (keep first occurrence)
      const seen = new Set();
      const deduplicated = [];
      for (const mem of allMemories) {
        const key = (mem.text || '').slice(0, 200).toLowerCase().trim();
        if (!key || seen.has(key)) continue;
        seen.add(key);
        deduplicated.push(mem);
      }
      
      // Save merged data
      await storageSet({ oml_memory: { profile: mergedProfile, memory: deduplicated } });
      
      const newCount = converted.length;
      const totalCount = deduplicated.length;
      showStatus(`✓ Added ${newCount} memories (${totalCount} total)`);
      render();
      
    } catch (e) {
      console.error("Import error:", e);
      showStatus("✗ Import failed - check console");
    }
  });
}

  if (refreshBtn) refreshBtn.addEventListener("click", () => render(searchInput ? searchInput.value : "", tagFilter ? tagFilter.value : ""));
  if (clearBtn) clearBtn.addEventListener("click", async () => {
    if (!confirm("Clear all local memories?")) return;
    await storageSet({ oml_memory: { profile:{}, memory:[] } });
    render();
  });

  document.getElementById('export')?.addEventListener('click', async () => {
  const data = await storageGet(['oml_memory']);
  const memObj = data.oml_memory || { profile: {}, memory: [] };
  
  const json = JSON.stringify(memObj, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  
  const a = document.createElement('a');
  a.href = url;
  a.download = `oml-export-${Date.now()}.json`;
  a.click();
  
  showStatus('Exported!');
  });

  // Show welcome note on first use
const dismissed = localStorage.getItem('oml_welcome_dismissed');
if (!dismissed) {
  document.getElementById('welcomeNote').style.display = 'block';
  document.getElementById('dismissWelcome')?.addEventListener('click', () => {
    localStorage.setItem('oml_welcome_dismissed', 'true');
    document.getElementById('welcomeNote').style.display = 'none';
  });
}

  // initial render
  render();
});
