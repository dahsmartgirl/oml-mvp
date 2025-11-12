// parser.js - better export parser for OML MVP
// Usage: const parsed = await parseExportFile(file);

function isPlainObject(x) { return x && typeof x === 'object' && !Array.isArray(x); }

// harvest all strings from nested structure
function collectStringsFromObject(obj, out=[]) {
  if (obj == null) return out;
  if (typeof obj === 'string') {
    out.push(obj);
    return out;
  }
  if (typeof obj === 'number' || typeof obj === 'boolean') {
    out.push(String(obj));
    return out;
  }
  if (Array.isArray(obj)) {
    for (const v of obj) collectStringsFromObject(v, out);
    return out;
  }
  if (isPlainObject(obj)) {
    for (const k of Object.keys(obj)) {
      const v = obj[k];
      // common message fields
      if (k.match(/^(content|text|message|body|utterance|reply|prompt)$/i) && (typeof v === 'string')) {
        out.push(v);
        continue;
      }
      // arrays that look like conversations/messages
      if (Array.isArray(v) && v.length && (v[0].content || v[0].text || v[0].message || typeof v[0] === 'string')) {
        for (const item of v) {
          if (item && typeof item === 'object') {
            if (item.content) out.push(item.content);
            else if (item.text) out.push(item.text);
            else if (item.message) out.push(item.message);
            else collectStringsFromObject(item, out);
          } else if (typeof item === 'string') {
            out.push(item);
          }
        }
        continue;
      }
      collectStringsFromObject(v, out);
    }
    return out;
  }
  return out;
}

function sentenceSplit(text) {
  // split into sentences, but avoid splitting on abbreviations bluntly.
  // Simple approach good enough for UI: split on period/newline/!/? but keep fragments > 10 chars.
  const parts = text.split(/[\r\n]+|[.?!]+/).map(s => s.trim()).filter(Boolean);
  return parts;
}

function looksLikeFact(s) {
  if (!s || s.length < 12) return false;
  const low = s.toLowerCase();
  // obvious useful patterns
  if (/\b(i am|i'm|my |name is|working on|building|founder|co[- ]found|project|graduat|live in|based in|prefer|likes|love|hate)\b/i.test(s)) return true;
  // proper noun sentences that start with capitalized word
  if (/^[A-Z][a-z]{2,}/.test(s)) return true;
  // fallback if contains at least one comma and > 40 chars (likely descriptive)
  if (s.length > 40 && s.includes(',')) return true;
  return false;
}

function cleanText(s) {
  if (!s) return '';
  // replace weird leading/trailing punctuation and stray quotes/commas
  return s.replace(/^[\s"'\u201c\u201d,;:-]+/, '').replace(/[\s"'\u201c\u201d,;:-]+$/, '').trim();
}

async function parseExportFile(file) {
  const text = await file.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch (err) {
    // fallback plain text as single memory
    const snippet = cleanText(text).slice(0, 1000);
    return { profile: {}, memory: snippet ? [snippet] : [] };
  }

  // If object already looks like OML memory format, accept it
  if (data && (data.profile || data.memory)) {
    const profile = data.profile || {};
    const mem = Array.isArray(data.memory) ? data.memory.map(m => cleanText(String(m))).filter(Boolean) : [];
    return { profile, memory: Array.from(new Set(mem)).slice(0, 500) };
  }

  // heuristics: pull profile-like fields
  const profile = {};
  if (data.user || data.profile) {
    const psrc = data.user || data.profile;
    if (isPlainObject(psrc)) {
      if (psrc.name) profile.name = String(psrc.name);
      if (psrc.role) profile.role = String(psrc.role);
      if (psrc.description) profile.description = String(psrc.description);
      if (psrc.location) profile.location = String(psrc.location);
    }
  }
  // also pull top-level known keys
  if (data.name && !profile.name) profile.name = String(data.name);
  if (data.email && !profile.email) profile.email = String(data.email);

  // If there's a direct messages/conversations array, extract those first
  let candidateStrings = [];
  const preferPaths = ['memory','memories','messages','conversations','chat','conversation','history','context_history'];
  for (const k of preferPaths) {
    if (k in data) {
      const v = data[k];
      if (Array.isArray(v)) {
        // push textual content from items
        for (const item of v) {
          if (!item) continue;
          if (typeof item === 'string') candidateStrings.push(item);
          else if (isPlainObject(item)) {
            if (item.content) candidateStrings.push(item.content);
            else if (item.text) candidateStrings.push(item.text);
            else if (item.message) candidateStrings.push(item.message);
            else {
              // try messages inside
              if (Array.isArray(item.messages)) {
                item.messages.forEach(m => { if (m && (m.content||m.text||m.message)) candidateStrings.push(m.content||m.text||m.message); });
              } else {
                candidateStrings.push(JSON.stringify(item).slice(0, 1000));
              }
            }
          } else {
            candidateStrings.push(String(item));
          }
        }
      } else {
        // single object or string
        candidateStrings.push(typeof v === 'string' ? v : JSON.stringify(v));
      }
    }
  }

  // If not found, do a recursive walk for strings
  if (candidateStrings.length === 0) {
    collectStringsFromObject(data, candidateStrings);
  }

  // Clean, split into sentences, then filter to likely facts
  const facts = new Set();
  for (const raw of candidateStrings) {
    if (!raw) continue;
    // ignore lines that are just JSON dumps
    const t = String(raw);
    // split into sentences
    const sents = sentenceSplit(t);
    for (const s of sents) {
      const c = cleanText(s);
      if (!c) continue;
      if (looksLikeFact(c)) {
        if (c.length <= 400) facts.add(c);
        else facts.add(c.slice(0, 300));
      }
    }
    // if we didn't find any facts inside this raw chunk but the chunk itself is short, keep it
    if (sents.length === 1) {
      const only = cleanText(sents[0]);
      if (only.length > 20 && only.length < 300 && !only.startsWith('{')) facts.add(only);
    }
  }

  // If nothing was mined as facts, fall back to some top strings (first N)
  if (facts.size === 0 && candidateStrings.length > 0) {
    for (const s of candidateStrings.slice(0, 200)) {
      const c = cleanText(String(s));
      if (c && c.length > 12 && c.length < 500) facts.add(c);
    }
  }

  // Final dedupe and ordering
  const memoryArray = Array.from(facts).map(s => s.replace(/\s+/g,' ').trim()).filter(Boolean);
  const trimmed = memoryArray.slice(0, 500);

  return { profile, memory: trimmed };
}
