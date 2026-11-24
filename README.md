# Conversation Atlas

Requires Node.js 20 or newer. Run `npm install`, `npm run build`, and `npm start`, then open http://localhost:3000. No API key is required. The server listens on localhost. For development, run `npm start` and `npm run dev` in separate terminals.

The server retrieves public ChatGPT shared links and analyzes the conversation locally with an extractive text heuristic. It groups related turns into sections, selects representative sentences, marks passages with explicit examples or moments of understanding, and connects related topics based on shared words. This is not a language model: it may miss nuance, group unrelated ideas, or misclassify a passage. Descriptions quote the original text; check the highlighted source. Shared-page formats can change or restrict access. Private or workspace-restricted links may not be accessible.

No conversation text is sent to an AI service or intentionally saved by the app. It remains in browser memory until the page is refreshed. A shared link may be viewed by anyone who has it; only submit content you have permission to share. No ChatGPT password is needed.
