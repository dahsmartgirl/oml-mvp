# ![oml logo](icon.png)OML – Open Memory Layer

**One memory layer. Every AI chatbot.**

---

## The Problem

You tell ChatGPT about your project.  
Then you switch to Claude and explain it again.  
Then Gemini. Then back to ChatGPT in a new session.

**Every AI treats you like a stranger.**

Your conversations are siloed. Your context is scattered. You explain yourself over and over.

---

## The Solution

**OML creates one unified memory layer that works across all AI chatbots.**

Save context once. Use it everywhere.

- Tell ChatGPT about your startup → OML saves it
- Switch to Claude → OML injects that same context
- New ChatGPT session tomorrow → OML remembers

**Your memories follow you. Not trapped in one app.**

---

## What It Does

### **Unified Memory Across All LLMs**
- Save memories once, use them in ChatGPT, Claude, Gemini, or any future AI
- No more re-explaining yourself across different chatbots
- Your context is portable, not siloed

### **Own Your Data**
- Everything stored locally in YOUR browser
- Export anytime (coming soon)
- No company owns your conversation history
- Future: Sync to YOUR cloud (Google Drive, Dropbox, iCloud)

### **Visualize Your Memory**
- See all your saved context in one place
- Search, filter, and organize by tags
- Understand what you've told AIs over time
- Track your conversations across platforms

### **Smart Organization**
- Auto-tags your memories (project, code, personal, etc.)
- Quick-edit tags and summaries
- Filter by topic or source

### **Privacy First**
- 100% local storage – nothing sent to servers
- Open source – verify the code yourself
- You control what gets saved

### **Built for the Future**
- APIs and SDKs coming
- Third-party integrations planned
- Extensible architecture and many more.

---
## Import Existing Chat History

Got old ChatGPT or Claude exports?

1. Click OML icon
2. Click "Upload"
3. Select your `.json` export file
4. OML extracts facts automatically
5. Now accessible across all AI platforms

## Install (2 minutes)

### Chrome/Edge/Brave

1. **Download this repo**
   - Click green `Code` button → `Download ZIP`
   - Unzip anywhere

2. **Load into browser**
   - Chrome: `chrome://extensions`
   - Enable "Developer mode" (top-right)
   - Click "Load unpacked"
   - Select the unzipped folder

3. **Done!** 
   - See the ![oml logo](icon.png) icon in your toolbar
   - Go to ChatGPT or Claude to try it

---

## How to Use

### Save Memory (Works Anywhere)

**Right-click method:**
1. Highlight text on any webpage
2. Right-click → "Save selection to OML"
3. Auto-tagged and saved

**Quick-edit method:**
1. Highlight text
2. Click "Save" button that appears
3. Shift+Click to add custom tags

**Manual entry:**
1. Click![oml logo](icon.png) icon in toolbar
2. Add text and tags
3. Save

### Use Across Different AIs

**Scenario:** You told ChatGPT about your project

1. Switch to Claude.ai
2. OML banner appears automatically
3. Click "Insert memory"
4. Your project context from ChatGPT is now in Claude

**No re-explaining. Your memory follows you.**

### Manage Everything

Click ![oml logo](icon.png) icon to:
- View all memories from all AI chats
- Search by keyword or tag
- See what you've told ChatGPT vs Claude
- Edit, organize, or delete
- Track your conversations over time

---

## Why This Matters

### **Right Now:**
```
You → ChatGPT: "I'm building a startup..."
[ChatGPT remembers in its silo]

You → Claude: "I'm building a startup..." 
[Explain again, Claude has separate memory]

You → New ChatGPT session: "I'm building a startup..."
[Explain AGAIN, memory was lost]
```

### **With OML:**
```
You → ChatGPT: "I'm building a startup..."
[OML saves it]

You → Claude: [OML auto-suggests that context]
[Click insert, Claude now knows]

You → New ChatGPT session: [OML remembers]
[Your context persists across sessions]
```

**Your memory becomes platform-agnostic.**

---

## Supported AI Platforms

Currently works on:
- ✅ ChatGPT (chat.openai.com, chatgpt.com)
- ✅ Claude (claude.ai)
- ✅ Gemini (gemini.google.com)
- ✅ Grok (grok.com)

Save from anywhere, insert into any of these.

More platforms coming soon.

---

## Roadmap

### **Phase 1 (Now) – Foundation**
- [x] Save memories from any site
- [x] Insert into ChatGPT, Claude, Gemini
- [x] Auto-tagging
- [x] Search and filter
- [x] Local storage

### **Phase 2 (Next) – Your Data, Your Cloud**
- [ ] Export all memories (JSON, CSV)
- [ ] Cloud sync (Google Drive, Dropbox, iCloud)
- [ ] Memory visualization dashboard
- [ ] Better relevance matching
- [ ] Bulk edit and organize

### **Phase 3 (Future) – Open Platform**
- [ ] Public API for memory access
- [ ] SDK for third-party integrations
- [ ] Mobile keyboard extension
- [ ] Cross-device sync
- [ ] Community memory templates

### **Vision – Universal Memory Layer**
- [ ] Works with ALL AI chatbots automatically
- [ ] Developer platform for building on OML
- [ ] Memory marketplace (share templates, prompts)
- [ ] Multi-modal memory (voice, images)

---



---

## Data Ownership

### **Your data belongs to YOU**

- Stored locally in your browser
- No servers, no company databases
- Export anytime
- Future: Sync to YOUR cloud accounts

### **Not like other "AI memory" tools**

| Other Tools | OML |
|------------|-----|
| Data stored on their servers | Local-first, your device |
| Works with one AI only | Works across all AIs |
| Closed source | Open source |
| Subscription required | Free forever |
| You can't export | You own everything |

---

## For Developers

### **Coming Soon: APIs & SDKs**

We're building OML as an open platform:
```javascript
// Future API (not implemented yet)
import { OML } from 'oml-sdk';

// Save memory programmatically
await OML.save({
  text: "User prefers React over Vue",
  tags: ["code", "preferences"],
  source: "my-app"
});

// Query memories
const relevant = await OML.query("react framework");

// Inject into any LLM
await OML.inject(relevant, { target: "chatgpt" });
```

Want to contribute? Open an issue or PR.

---

## FAQ

**Q: Why not just use ChatGPT's memory feature?**  
A: ChatGPT memory only works in ChatGPT. OML works everywhere. Plus you own the data.

**Q: Where is my data stored?**  
A: Locally in `chrome.storage.local`. It never leaves your device unless YOU choose to sync.

**Q: Can I use memories from Claude in ChatGPT?**  
A: YES. That's the whole point. One memory layer, every AI.

**Q: Is this like a second brain / PKM tool?**  
A: Similar idea, but specifically built for AI context. Think Notion/Obsidian but for LLM memory.

**Q: Will there be a mobile version?**  
A: Yes, mobile keyboard extension is planned (Phase 2).

**Q: Can I self-host the API?**  
A: When we release the API, yes. It's open source.

**Q: How is this different from RAG?**  
A: RAG is for documents. OML is for personal context and conversation memory.

---

## Known Limitations

- Memory relevance uses keyword matching (can be improved)
- Desktop only (mobile coming)
- Manual insertion recommended (auto-suggestion being refined)

This is v0.1 – early but functional.

---

## Contributing

This is open source. PRs welcome.

**Want to help?**
- Test it and report bugs
- Suggest features (open an issue)
- Contribute code (fork + PR)
- Share it with others

---

## License

MIT License – Use it however you want.

See `LICENSE` file for full terms.

---

## Why I Built This

**I was tired of AI amnesia.**

I'd spend 10 minutes explaining my project to ChatGPT.  
Then switch to Claude and do it again.  
Then start a new ChatGPT chat and explain AGAIN.

**My context was scattered across platforms, trapped in silos.**

I wanted ONE memory layer that worked everywhere.  
I wanted to OWN my conversation data.  
I wanted to see all my AI interactions in one place.

I am not a dev but i had to do something.

So I built OML.
This is the beginning of portable, user-owned AI memory.

---

**Star this repo ⭐ if you believe AI memory should belong to users, not platforms**

Built with frustration and determination by Ilerioluwa🌟

Questions? Open an issue.