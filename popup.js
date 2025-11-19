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

function escapeHtml(s = "") {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
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

let currentSort = 'date_desc'; // Default sort

async function render(filterQuery = "", filterTag = "") {
  const all = await storageGet(["oml_memory"]);
  const memObj = all.oml_memory || { profile:{}, memory:[] };
  const p = memObj.profile || {};
  const memoryRaw = Array.isArray(memObj.memory) ? memObj.memory : [];

  // Profile
  const profileName = document.getElementById("profileName");
  if (profileName) {
    profileName.innerHTML = ''; // Clear previous content
    const nameText = document.createTextNode(p.name || 'Ileri');
    const separatorText = document.createTextNode(' • ');
    const roleText = document.createTextNode(p.role || 'Product designer and founder');
    profileName.append(nameText, separatorText, roleText);
  }
  const profileDesc = document.getElementById("profileDesc");
  if (profileDesc) {
    profileDesc.textContent = escapeHtml(p.description || p.about || 'Tech-savvy designer obsessed with clean interfaces, AI tools, and building products that lap');
  }
  const profileLocation = document.getElementById("profileLocation");
  if (profileLocation) {
    profileLocation.innerHTML = `
      <img src="assets/location.svg" width="20" height="20" alt="Location">
      ${escapeHtml(p.location || 'Boston, MA')}
    `;
  }

  // Filter memory list
  let filtered = [...memoryRaw];
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

  // Sort
  if (currentSort === 'date_asc') {
    filtered.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  } else if (currentSort === 'has_link') {
    filtered = filtered.filter(m => m.page_url);
    filtered.sort((a, b) => new Date(b.created_at) - new Date(a.created_at)); // Still sort by date
  } else { // date_desc is default
    filtered.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  }

  // Render tags select
  const tagsSelect = document.getElementById("tagFilter");
  if (tagsSelect) {
    const allTags = collectTags(memoryRaw);
    const currentTag = tagsSelect.value;
    tagsSelect.innerHTML = `<option value="">All Tags</option>` + allTags.map(t => {
      const selected = (t === currentTag) ? ' selected' : '';
      return `<option value="${escapeHtml(t)}"${selected}>${escapeHtml(t)}</option>`;
    }).join("");
    if (filterTag) tagsSelect.value = filterTag;
  }

  // Render memories title
  const memoriesTitle = document.getElementById("memoriesTitle");
  if (memoriesTitle) {
    memoriesTitle.textContent = `My memories (${filtered.length})`;
  }

  // Render list
  const memList = document.getElementById("memList");
  if (!memList) return;
  memList.innerHTML = "";
  if (!filtered.length) {
    memList.innerHTML = "<div style='padding:8px;color:#666'>No memories found.</div>";
    return;
  }

  filtered.forEach((m, i) => {
    const item = document.createElement("div");
    item.className = "mem-item";
    item.innerHTML = `
      <div class="mem-content" data-fulltext="${escapeHtml(m.text || "")}">
        <div class="mem-text">${escapeHtml(m.summary || (m.text && m.text.slice(0, 300)) || "")}</div>
        <div class="mem-tags"></div>
        <div class="mem-meta"></div>
      </div>
      <div class="mem-actions">
        <button class="mem-action insert" title="Insert into active chat">
          <img src="assets/insert.svg" width="20" height="20" alt="Insert">
        </button>
        <button class="mem-action copy" title="Copy text">
          <img src="assets/copy.svg" width="20" height="20" alt="Copy">
        </button>
        <div class="mem-more-container">
          <button class="mem-action more" title="More actions">
            <img src="assets/more.svg" width="20" height="20" alt="More">
          </button>
          <div class="mem-dropdown-menu">
            <a href="#" class="edit">Edit</a>
            <a href="#" class="delete">Delete</a>
          </div>
        </div>
      </div>
    `;
    // Click for full
    const contentDiv = item.querySelector(".mem-content");
    contentDiv.addEventListener("click", () => {
      const memTextDiv = contentDiv.querySelector(".mem-text");
      const isShowingSummary = !memTextDiv.classList.contains('full-text');
      
      memTextDiv.innerHTML = isShowingSummary ? contentDiv.dataset.fulltext : escapeHtml(m.summary || (m.text && m.text.slice(0, 300)) || "");
      memTextDiv.classList.toggle('full-text', isShowingSummary);
      // The modal is no longer needed for this, but we can keep it for the edit button
    });

    // Populate tags and make them clickable
    const tagsContainer = item.querySelector('.mem-tags');
    (m.tags || []).slice(0, 3).forEach(tag => {
      const tagEl = document.createElement('div');
      tagEl.className = 'mem-tag';
      tagEl.textContent = escapeHtml(tag);
      tagEl.addEventListener('click', (e) => {
        e.stopPropagation(); // prevent card from expanding
        document.getElementById('tagFilter').value = tag;
        render(document.getElementById('search').value, tag); // Re-render with the new tag filter
      });
      tagsContainer.appendChild(tagEl);
    });

    // Populate metadata and make link clickable
    const metaContainer = item.querySelector('.mem-meta');
    const linkText = escapeHtml(m.page_title || m.page_url || "");
    if (m.page_url) {
      const linkEl = document.createElement('a');
      linkEl.href = m.page_url;
      linkEl.textContent = linkText;
      linkEl.target = "_blank";
      linkEl.addEventListener('click', (e) => e.stopPropagation()); // prevent card from expanding
      metaContainer.appendChild(linkEl);
    } else {
      metaContainer.textContent = linkText;
    }
    const metaRest = document.createElement('span');
    metaRest.innerHTML = ` • ${escapeHtml(formatDate(m.created_at))} • ${escapeHtml(m.source || "")}`;
    metaContainer.appendChild(metaRest);

    // Actions
    item.querySelector(".insert").addEventListener("click", async (e) => {
      e.stopPropagation();
      const res = await trySendInsertToActiveTab(m.text);
      showStatus(res.ok ? "Inserted!" : "No active chat to insert into.");
    });
    item.querySelector(".copy").addEventListener("click", async () => {
      try { await navigator.clipboard.writeText(m.text); showStatus("Copied!"); } catch(e) { showStatus("Copy failed"); }
    });

    const moreBtn = item.querySelector('.more');
    const moreMenu = item.querySelector('.mem-dropdown-menu');
    moreBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      moreMenu.style.display = moreMenu.style.display === 'block' ? 'none' : 'block';
    });

    item.querySelector(".edit").addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      moreMenu.style.display = 'none';

      // Populate and show the edit modal
      const memoryEditModal = document.getElementById('memoryEditModal');
      if (memoryEditModal) {
        document.getElementById('memoryIdInput').value = m.id;
        document.getElementById('memorySummaryInput').value = m.summary || '';
        document.getElementById('memoryTextInput').value = m.text || '';
        document.getElementById('memoryTagsInput').value = (m.tags || []).join(', ');
        memoryEditModal.style.display = 'flex';
      }
    });


    item.querySelector(".delete").addEventListener("click", async (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (confirm("Delete?")) {
        await deleteMemoryById(m.id);
        render();
      }
      moreMenu.style.display = 'none';
    });
    memList.appendChild(item);
  });
}

function showStatus(msg = "") {
  const searchInput = document.getElementById("search");
  if (searchInput) {
    const originalPlaceholder = searchInput.placeholder;
    searchInput.value = ''; // Clear search
    searchInput.placeholder = msg;
    setTimeout(() => { searchInput.placeholder = originalPlaceholder; }, 2000);
  }
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

async function updateProfile(newProfile) {
  const all = await storageGet(['oml_memory']);
  const root = all.oml_memory || { profile:{}, memory:[] };
  root.profile = { ...root.profile, ...newProfile };
  await storageSet({ oml_memory: root });
  render();
}

document.addEventListener("DOMContentLoaded", () => {
  const dropArea = document.getElementById("dropArea");
  const fileInput = document.getElementById("file");
  const browseLink = document.getElementById("browseLink");
  const refreshBtn = document.getElementById("refresh");
  const moreBtn = document.getElementById("moreBtn");
  const moreMenu = document.getElementById("moreMenu");
  const clearBtn = document.getElementById("clear");
  const exportBtn = document.getElementById("export");
  const searchInput = document.getElementById("search");
  const tagFilter = document.getElementById("tagFilter");
  const sortBtn = document.getElementById("sortBtn");
  const sortMenu = document.getElementById("sortMenu");
  const editProfile = document.getElementById("editProfile");
  const closeModal = document.getElementById("closeModal");
  const memModal = document.getElementById("memModal");
  const profileModal = document.getElementById("profileModal");
  const closeProfileModal = document.getElementById("closeProfileModal");
  const profileForm = document.getElementById("profileForm");
  const memoryEditModal = document.getElementById("memoryEditModal");
  const closeMemoryEditModal = document.getElementById("closeMemoryEditModal");
  const memoryEditForm = document.getElementById("memoryEditForm");

  // Drag/drop
  if (dropArea) {
    dropArea.addEventListener("dragover", (e) => {
      e.preventDefault();
      dropArea.classList.add("dragover");
    });
    dropArea.addEventListener("dragleave", () => dropArea.classList.remove("dragover"));
    dropArea.addEventListener("drop", (e) => {
      e.preventDefault();
      dropArea.classList.remove("dragover");
      const files = e.dataTransfer.files;
      if (files.length && files[0].type === "application/json") {
        handleUpload(files[0]);
      } else {
        showStatus("⚠ Only .json files supported");
      }
    });
  }

  // Browse
  if (browseLink) {
    browseLink.addEventListener("click", () => fileInput.click());
  }

  // File change
  if (fileInput) {
    fileInput.addEventListener("change", () => {
      if (fileInput.files[0]) handleUpload(fileInput.files[0]);
    });
  }

  async function handleUpload(f) {
    try {
      showStatus("Importing...");
      const parsed = await parseExportFile(f);
      const current = await storageGet(['oml_memory']);
      const root = current.oml_memory || { profile: {}, memory: [] };

      // Merge profile
      const newProfile = { ...root.profile, ...(parsed.profile || {}) };

      // Merge and deduplicate memories
      const combined = [...(parsed.memory || []), ...(root.memory || [])];
      const dedupedMemory = [];
      const seen = new Set();
      for (const item of combined) {
        const key = item.id || item.text.slice(0, 100);
        if (!seen.has(key)) {
          seen.add(key);
          dedupedMemory.push(item);
        }
      }
      
      await storageSet({ oml_memory: { profile: newProfile, memory: dedupedMemory } });
      showStatus(`✔ Imported ${parsed.memory.length} memories!`);
      render();
    } catch (e) {
      showStatus(`✗ Import failed: ${e.message}`);
    }
  }

  // Search
  let t;
  if (searchInput) {
    searchInput.addEventListener("input", () => {
      clearTimeout(t);
      t = setTimeout(() => render(searchInput.value, tagFilter ? tagFilter.value : ""), 180);
    });
  }

  // Tag filter
  if (tagFilter) {
    tagFilter.addEventListener("change", () => {
      const query = searchInput ? searchInput.value : "";
      const tag = tagFilter.value;
      // If a tag is de-selected, we don't automatically clear the search bar anymore.
      render(searchInput.value, tag);
    });
  }

  // Sort menu
  if (sortBtn && sortMenu) {
    sortBtn.addEventListener("click", () => {
      sortMenu.style.display = sortMenu.style.display === "block" ? "none" : "block";
    });

    sortMenu.addEventListener("click", (e) => {
      if (e.target.tagName === 'A') {
        e.preventDefault();
        currentSort = e.target.dataset.sort;
        sortMenu.style.display = "none";
        render(searchInput.value, tagFilter.value);
      }
    });
  }



  // Refresh
  if (refreshBtn) refreshBtn.addEventListener("click", () => render(searchInput.value, tagFilter.value));

  // More menu
  if (moreBtn && moreMenu) {
    moreBtn.addEventListener("click", () => {
      moreMenu.style.display = moreMenu.style.display === "none" ? "block" : "none";
    });
    document.addEventListener("click", (e) => {
      if (moreMenu.style.display === 'block' && !moreBtn.contains(e.target) && !moreMenu.contains(e.target)) {
        moreMenu.style.display = "none";
      }
    });
  }

  // Clear
  if (clearBtn) clearBtn.addEventListener("click", async () => {
    if (!confirm("Clear all local memories?")) return;
    await storageSet({ oml_memory: { profile:{}, memory:[] } });
    render();
    moreMenu.style.display = "none";
  });

  // Export
  if (exportBtn) exportBtn.addEventListener('click', async () => {
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
    moreMenu.style.display = "none";
  });

  // Edit profile
  if (editProfile && profileModal) editProfile.addEventListener("click", async () => {
    const currentData = await storageGet(['oml_memory']);
    const currentProfile = (currentData.oml_memory && currentData.oml_memory.profile) || {};
    
    // Populate form
    document.getElementById('profileNameInput').value = currentProfile.name || '';
    document.getElementById('profileRoleInput').value = currentProfile.role || '';
    document.getElementById('profileDescInput').value = currentProfile.description || '';
    document.getElementById('profileLocationInput').value = currentProfile.location || '';

    profileModal.style.display = "flex";
  });

  if (profileForm) profileForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const newProfile = {
      name: document.getElementById('profileNameInput').value,
      role: document.getElementById('profileRoleInput').value,
      description: document.getElementById('profileDescInput').value,
      location: document.getElementById('profileLocationInput').value,
    };
    await updateProfile(newProfile);
    profileModal.style.display = "none";
  });

  // Memory Edit Form
  if (memoryEditForm) memoryEditForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = document.getElementById('memoryIdInput').value;
    const summary = document.getElementById('memorySummaryInput').value;
    const text = document.getElementById('memoryTextInput').value;
    const tags = document.getElementById('memoryTagsInput').value.split(',').map(t => t.trim()).filter(Boolean);

    const all = await storageGet(['oml_memory']);
    const memoryItem = (all.oml_memory.memory || []).find(mem => mem.id === id);

    if (memoryItem) {
      const updatedItem = { ...memoryItem, summary, text, tags };
      await updateMemoryItem(updatedItem);
      memoryEditModal.style.display = 'none';
      render(searchInput.value, tagFilter.value);
    }
  });

  // Modal
  if (closeModal && memModal) {
    closeModal.addEventListener("click", () => memModal.style.display = "none");
    memModal.addEventListener("click", (e) => { if (e.target === memModal) memModal.style.display = "none"; });
  }
  if (closeProfileModal && profileModal) {
    closeProfileModal.addEventListener("click", () => profileModal.style.display = "none");
    profileModal.addEventListener("click", (e) => { if (e.target === profileModal) profileModal.style.display = "none"; });
  }
  if (closeMemoryEditModal && memoryEditModal) {
    closeMemoryEditModal.addEventListener("click", () => memoryEditModal.style.display = "none");
    memoryEditModal.addEventListener("click", (e) => { if (e.target === memoryEditModal) memoryEditModal.style.display = "none"; });
  }

  // initial render
  render();
});

// --- Parser functions moved from parser.js ---

function isPlainObject(x) { 
  return x && typeof x === 'object' && !Array.isArray(x); 
}

async function parseExportFile(file) {
  const text = await file.text();
  let data;
  
  try {
    data = JSON.parse(text);
  } catch (err) {
    // Not JSON - treat as plain text
    const snippet = text.trim().slice(0, 1000);
    return { 
      profile: {}, 
      memory: snippet ? [{ text: snippet, tags: [], summary: snippet.slice(0, 200) }] : [] 
    };
  }

  // FIRST: Check if this is OML's own export format
  if (data && (data.profile !== undefined || data.memory !== undefined)) {
    console.log("Detected OML export format");
    
    const profile = data.profile || {};
    let memories = [];
    
    if (Array.isArray(data.memory)) {
      memories = data.memory.map(m => {
        // Already in correct format
        if (m && typeof m === 'object' && m.text) {
          return {
            id: m.id || ('m_imp_' + Date.now() + '_' + Math.random().toString(36).slice(2,6)),
            text: String(m.text || ''),
            summary: m.summary || String(m.text || '').slice(0, 220),
            tags: Array.isArray(m.tags) ? m.tags : [],
            page_title: m.page_title || '',
            page_url: m.page_url || '',
            source: m.source || 'import',
            created_at: m.created_at || new Date().toISOString(),
            selectorHint: m.selectorHint,
            snippet: m.snippet,
            hostname: m.hostname
          };
        }
        // String format
        if (typeof m === 'string') {
          return {
            id: 'm_imp_' + Date.now() + '_' + Math.random().toString(36).slice(2,6),
            text: m,
            summary: m.slice(0, 220),
            tags: [],
            page_title: '',
            page_url: '',
            source: 'import',
            created_at: new Date().toISOString()
          };
        }
        return null;
      }).filter(Boolean);
    }
    
    console.log(`Parsed ${memories.length} memories from OML export`);
    return { profile, memory: memories };
  }

  // SECOND: Try to parse as ChatGPT/Claude export
  console.log("Trying generic chat export format");
  
  const profile = {};
  
  // Extract profile if exists
  if (data.user || data.profile) {
    const psrc = data.user || data.profile;
    if (isPlainObject(psrc)) {
      if (psrc.name) profile.name = String(psrc.name);
      if (psrc.role) profile.role = String(psrc.role);
      if (psrc.description) profile.description = String(psrc.description);
      if (psrc.location) profile.location = String(psrc.location);
    }
  }
  
  // Top-level profile fields
  if (data.name && !profile.name) profile.name = String(data.name);
  if (data.email && !profile.email) profile.email = String(data.email);

  // Extract memories from various possible structures
  let candidateStrings = [];
  
  // Check common chat export paths
  const paths = ['messages', 'conversations', 'chat', 'history', 'mapping'];
  for (const path of paths) {
    if (path in data) {
      const val = data[path];
      
      if (Array.isArray(val)) {
        val.forEach(item => {
          if (!item) return;
          
          if (typeof item === 'string') {
            candidateStrings.push(item);
          } else if (isPlainObject(item)) {
            // Extract text content
            if (item.content) candidateStrings.push(String(item.content));
            if (item.text) candidateStrings.push(String(item.text));
            if (item.message) candidateStrings.push(String(item.message));
            
            // Check for nested messages
            if (Array.isArray(item.messages)) {
              item.messages.forEach(msg => {
                if (msg && (msg.content || msg.text)) {
                  candidateStrings.push(String(msg.content || msg.text));
                }
              });
            }
          }
        });
      } else if (isPlainObject(val)) {
        // Mapping object (ChatGPT format)
        Object.values(val).forEach(node => {
          if (node && node.message && node.message.content) {
            if (typeof node.message.content === 'string') {
              candidateStrings.push(node.message.content);
            } else if (Array.isArray(node.message.content.parts)) {
              node.message.content.parts.forEach(part => {
                if (typeof part === 'string') candidateStrings.push(part);
              });
            }
          }
        });
      }
    }
  }

  // If nothing found, do a recursive search
  if (candidateStrings.length === 0) {
    console.log("No structured data found, doing deep search");
    candidateStrings = collectStringsRecursive(data);
  }

  // Clean and deduplicate
  const cleaned = candidateStrings
    .map(s => String(s).trim())
    .filter(s => s.length > 15 && s.length < 5000) // Reasonable length
    .filter((s, i, arr) => arr.indexOf(s) === i); // Dedupe

  const memories = cleaned.slice(0, 500).map(text => ({
    id: 'm_imp_' + Date.now() + '_' + Math.random().toString(36).slice(2,6),
    text: text,
    summary: text.slice(0, 220),
    tags: [],
    page_title: 'Import',
    page_url: '',
    source: 'import',
    created_at: new Date().toISOString()
  }));

  console.log(`Extracted ${memories.length} memories from chat export`);
  return { profile, memory: memories };
}

function collectStringsRecursive(obj, depth = 0, results = []) {
  if (depth > 10) return results; // Prevent infinite recursion
  if (!obj) return results;
  
  if (typeof obj === 'string') {
    results.push(obj);
    return results;
  }
  
  if (Array.isArray(obj)) {
    obj.forEach(item => collectStringsRecursive(item, depth + 1, results));
    return results;
  }
  
  if (isPlainObject(obj)) {
    for (const key of Object.keys(obj)) {
      const val = obj[key];
      
      // Prioritize content-like keys
      if (key.match(/content|text|message|body/i) && typeof val === 'string') {
        results.push(val);
      } else {
        collectStringsRecursive(val, depth + 1, results);
      }
    }
  }
  
  return results;
}
