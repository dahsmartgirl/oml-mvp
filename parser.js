// parser.js - Fixed parser that handles OML exports first, then other formats

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