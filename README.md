# OML — Open Memory Layer (MVP)

Quick start (dev):

1. Clone folder.
2. Open Chrome -> chrome://extensions/ -> Developer mode -> Load unpacked and select this folder.
3. Click the OML extension icon -> upload a chat export JSON (or paste text file).
4. Open chat.openai.com (or a supported site). The OML banner with your summary will appear above the input box.

Notes:
- MVP parses plain JSON exports and uses simple heuristics to extract facts.
- Memory is stored locally using chrome.storage.local.
- This prototype shows a small banner in LLM chat pages. It does not auto-paste into your message (safer UX).
- Next steps: support ZIP exports, better parsing, auto-add with confirmation, per-site toggles, sync options.

License: MIT
