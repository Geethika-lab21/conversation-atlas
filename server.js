import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { URL } from 'node:url';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { localAnalyze } from './local-analysis.js';

const port = Number(process.env.PORT || 3000);
const root = new URL('.', import.meta.url);
const types = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml'};
const send = (res, status, data) => { res.writeHead(status, {'content-type':'application/json; charset=utf-8','cache-control':'no-store'}); res.end(JSON.stringify(data)); };

export function extract(html, rawStream = false) {
  const scripts = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi)].map(m => m[1]);
  const candidates = [];
  const seen = new WeakSet();
  function walk(v, depth = 0) {
    if (!v || typeof v !== 'object' || depth > 80) return;
    if (seen.has(v)) return;
    seen.add(v);
    if (v.author?.role && v.content && ['user','assistant'].includes(v.author.role)) {
      const parts = v.content.parts || [];
      const text = (Array.isArray(parts) ? parts.map(x => typeof x === 'string' ? x : (typeof x?.text === 'string' ? x.text : '')).filter(Boolean).join('\n') : (typeof v.content.text === 'string' ? v.content.text : '')).trim();
      if (text) candidates.push({id:String(v.id || candidates.length), role:v.author.role, text, time:v.create_time || 0});
    }
    for (const value of Object.values(v)) walk(value, depth + 1);
  }
  // React Router streams a flattened object graph in one or more JSON-escaped
  // strings. Decode references without evaluating any code from the page.
  const chunks = rawStream ? [html] : [];
  if (!rawStream) for (const match of html.matchAll(/streamController\.enqueue\(\s*("(?:\\.|[^"\\])*")\s*\)/g)) {
    try { chunks.push(JSON.parse(match[1])); } catch {}
  }
  if (chunks.length) {
    try {
      const lines = chunks.join('').split('\n');
      const flat = JSON.parse(lines[0]);
      if (Array.isArray(flat) && flat.length <= 1000000) {
        const memo = new Map();
        const resolveIndex = (index, depth = 0) => {
          if (!Number.isInteger(index) || index < 0 || index >= flat.length || depth > 150) return null;
          if (memo.has(index)) return memo.get(index);
          const value = flat[index];
          if (Array.isArray(value)) {
            const result = []; memo.set(index, result);
            for (const item of value) result.push(typeof item === 'number' && Number.isInteger(item) ? resolveIndex(item, depth + 1) : item);
            return result;
          }
          if (value && typeof value === 'object') {
            const result = Object.create(null); memo.set(index, result);
            for (const [key, item] of Object.entries(value)) {
              const name = /^_\d+$/.test(key) ? resolveIndex(Number(key.slice(1)), depth + 1) : key;
              if (typeof name === 'string') result[name] = typeof item === 'number' && Number.isInteger(item) ? resolveIndex(item, depth + 1) : item;
            }
            return result;
          }
          if (typeof value === 'number' && Number.isInteger(value)) return resolveIndex(value, depth + 1);
          return value;
        };
        walk(resolveIndex(0));
      }
    } catch { /* Fall back to the older JSON formats below. */ }
  }
  for (const script of scripts) {
    try { walk(JSON.parse(script)); } catch {}
    // Some shared pages embed escaped JSON inside a streaming script.
    for (const match of script.matchAll(/"((?:\\.|[^"\\]){100,})"/g)) {
      try { const decoded = JSON.parse('"' + match[1] + '"'); if (decoded.includes('"author"')) walk(JSON.parse(decoded)); } catch {}
    }
  }
  const unique = [...new Map(candidates.map(x => [x.id, x])).values()];
  if (unique.some(x => x.time)) unique.sort((a,b) => a.time - b.time);
  return unique;
}
async function importLink(link) {
  let url; try { url = new URL(link); } catch { throw new Error('Enter a valid ChatGPT shared conversation URL.'); }
  if (['chatgpt.com','chat.openai.com'].includes(url.hostname) && /^\/c\//.test(url.pathname)) throw new Error('This is a private chat link. In ChatGPT, open the conversation, select Share, and copy the shared link (which starts with https://chatgpt.com/share/). Anyone with that link may be able to view the conversation.');
  if (!['https:'].includes(url.protocol) || !['chatgpt.com','chat.openai.com'].includes(url.hostname) || !/^\/share\/[a-zA-Z0-9-]+\/?$/.test(url.pathname)) throw new Error('Use a public ChatGPT shared link, such as https://chatgpt.com/share/…');
  const response = await fetch(url, {redirect:'manual', signal:AbortSignal.timeout(15000), headers:{'user-agent':'Mozilla/5.0 ConversationAtlas/1.0'}});
  if (!response.ok) throw new Error('This shared link could not be accessed. It may be invalid, expired, private, or restricted.');
  const html = await response.text();
  if (html.length > 8_000_000) throw new Error('This conversation is too large to import.');
  let messages = extract(html);
  if (messages.length < 2) {
    // Some requests receive only an HTML preview. The same public share route
    // may expose its React Router data separately; never follow redirects here.
    const dataUrl = new URL(url); dataUrl.pathname = url.pathname.replace(/\/$/, '') + '.data'; dataUrl.search = '';
    try {
      const dataResponse = await fetch(dataUrl, {redirect:'manual', signal:AbortSignal.timeout(15000), headers:{'user-agent':'Mozilla/5.0 ConversationAtlas/1.0'}});
      if (dataResponse.ok) {
        const data = await dataResponse.text();
        if (data.length <= 8_000_000) messages = extract(data, true);
      }
    } catch { /* Report the unsupported or inaccessible page below. */ }
  }
  if (messages.length < 2) throw new Error('The shared page opened, but its conversation could not be read. It may be restricted, expired, empty, or use a format this app does not yet support.');
  return messages;
}
export const server = http.createServer(async (req,res) => {
  try {
    if (req.method === 'POST' && req.url === '/api/map') {
      let body=''; for await (const chunk of req) { body += chunk; if (body.length > 10000) return send(res,413,{error:'Request is too large.'}); }
      const {link} = JSON.parse(body);
      const messages = await importLink(link); const map = localAnalyze(messages); return send(res,200,{messages,map});
    }
    if (req.method !== 'GET') return send(res,405,{error:'Method not allowed'});
    const path = new URL(req.url,'http://localhost').pathname;
    const dist = fileURLToPath(new URL('dist/', root));
    const file = resolve(dist, '.' + (path === '/' ? '/index.html' : path));
    if (!file.startsWith(dist.endsWith(sep) ? dist : dist + sep)) return send(res,404,{error:'Not found'});
    try { const content = await readFile(file); res.writeHead(200,{'content-type':types[extname(file)] || 'application/octet-stream', 'cache-control':'no-store'}); res.end(content); }
    catch { return send(res,404,{error:'File not found. Run npm run build first.'}); }
  } catch (error) { send(res,400,{error:error.name === 'TimeoutError' ? 'The request timed out. Please try again.' : error.message || 'Something went wrong. Please try again.'}); }
});
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) server.listen(port, '127.0.0.1', () => console.log(`Conversation Atlas running at http://localhost:${port}`));
