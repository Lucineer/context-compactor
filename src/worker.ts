interface Env { COMPACTOR_KV: KVNamespace; }

const CSP = {
  'default-src': "'self'",
  'script-src': "'self' 'unsafe-inline'",
  'style-src': "'self' 'unsafe-inline'",
  'img-src': "'self' data:",
  'connect-src': "'self'",
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', ...CSP } });
}

function extractive(text: string, ratio: number): { compacted: string; sentences: number; original: number } {
  const sentences = text.match(/[^.!?]+[.!?]+/g) || [text];
  if (sentences.length <= 3) return { compacted: text, sentences: sentences.length, original: sentences.length };

  const words = text.toLowerCase().split(/\s+/);
  const freq: Record<string, number> = {};
  for (const w of words) {
    if (w.length > 3) freq[w] = (freq[w] || 0) + 1;
  }

  const scored = sentences.map((s, i) => {
    const sWords = s.toLowerCase().split(/\s+/);
    let score = 0;
    for (const w of sWords) score += freq[w] || 0;
    score /= Math.max(sWords.length, 1);
    if (i === 0 || i === sentences.length - 1) score *= 1.3; // boost first/last
    return { sentence: s.trim(), score, index: i };
  });

  scored.sort((a, b) => b.score - a.score);
  const keep = Math.max(2, Math.ceil(sentences.length * ratio));
  const selected = scored.slice(0, keep).sort((a, b) => a.index - b.index);
  return { compacted: selected.map(s => s.sentence).join(' '), sentences: selected.length, original: sentences.length };
}

function slidingWindow(text: string, windowSize: number): { compacted: string; ratio: number } {
  if (text.length <= windowSize * 2) return { compacted: text, ratio: 1 };
  const sentences = text.match(/[^.!?]+[.!?]+/g) || [text];
  const chunkSize = Math.max(1, Math.ceil(sentences.length / Math.ceil(text.length / windowSize)));
  const chunks: string[] = [];
  for (let i = 0; i < sentences.length; i += chunkSize) {
    chunks.push(sentences.slice(i, i + chunkSize).join(' '));
  }
  return { compacted: chunks.join(' ... '), ratio: chunks.length / sentences.length };
}

function keyphrase(text: string, count: number): { compacted: string; phrases: string[] } {
  const words = text.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(w => w.length > 3);
  const bigrams: Record<string, number> = {};
  for (let i = 0; i < words.length - 1; i++) {
    const bg = `${words[i]} ${words[i + 1]}`;
    bigrams[bg] = (bigrams[bg] || 0) + 1;
  }
  const sorted = Object.entries(bigrams).sort((a, b) => b[1] - a[1]).slice(0, count);
  const phrases = sorted.map(([bg]) => bg);
  return { compacted: phrases.join('; '), phrases };
}

function getLanding(): string {
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Context Compactor — Cocapn Fleet</title>
<style>
body{font-family:system-ui,sans-serif;background:#0a0a0f;color:#e0e0e0;margin:0;min-height:100vh}
.container{max-width:700px;margin:0 auto;padding:40px 20px}
h1{color:#f59e0b;font-size:2.2em;margin-bottom:.2em}
.subtitle{color:#8A93B4;font-size:1.1em;margin-bottom:2em}
.card{background:#16161e;border:1px solid #2a2a3a;border-radius:12px;padding:24px;margin:20px 0}
.card h3{color:#f59e0b;margin:0 0 12px 0}
textarea{width:100%;background:#0a0a0f;color:#e0e0e0;border:1px solid #2a2a3a;border-radius:8px;padding:12px;font-family:monospace;box-sizing:border-box}
select,.btn{background:#f59e0b;color:#0a0a0f;border:none;padding:10px 20px;border-radius:8px;cursor:pointer;font-weight:bold}
.btn:hover{background:#d97706}
select{appearance:auto;background:#16161e;color:#e0e0e0;border:1px solid #2a2a3a}
.result{background:#1a1a2a;padding:16px;border-radius:8px;margin-top:12px;font-size:.9em;color:#8A93B4}
.result strong{color:#f59e0b}
pre{background:#0a0a0f;padding:12px;border-radius:8px;overflow-x:auto;font-size:.85em;color:#8A93B4}
.metrics{display:flex;gap:16px;margin:8px 0}
.metric{padding:8px 16px;background:#0a0a0f;border-radius:8px;text-align:center}
.metric .val{font-size:1.5em;color:#f59e0b;font-weight:bold}
.metric .lbl{font-size:.75em;color:#8A93B4}
</style></head><body><div class="container">
<h1>🧊 Context Compactor</h1>
<p class="subtitle">Compress long text to fit Worker memory limits. No external API calls.</p>
<div class="card">
  <h3>Input</h3>
  <textarea id="input" rows="6" placeholder="Paste long text to compress..."></textarea>
  <div style="margin-top:12px;display:flex;gap:8px;align-items:center">
    <select id="strategy">
      <option value="extractive">Extractive (top sentences)</option>
      <option value="sliding">Sliding Window (summary chunks)</option>
      <option value="keyphrase">Keyphrase Extraction</option>
    </select>
    <label style="color:#8A93B4;font-size:.9em">Ratio:
      <select id="ratio" style="display:inline;width:auto;padding:6px 10px">
        <option value="0.5">50%</option>
        <option value="0.3" selected>30%</option>
        <option value="0.2">20%</option>
        <option value="0.1">10%</option>
      </select>
    </label>
    <button class="btn" onclick="compact()">Compress</button>
  </div>
</div>
<div id="result" class="card" style="display:none">
  <h3>Result</h3>
  <div class="metrics" id="metrics"></div>
  <pre id="output"></pre>
</div>
<div class="card">
  <h3>API</h3>
  <pre>POST /api/compact
{
  "text": "long text...",
  "strategy": "extractive|sliding|keyphrase",
  "ratio": 0.3,
  "windowSize": 500
}</pre>
</div>
<div style="text-align:center;padding:24px;color:#475569;font-size:.75rem">
<a href="https://the-fleet.casey-digennaro.workers.dev" style="color:#64748b">The Fleet</a> &middot;
<a href="https://cocapn.ai" style="color:#64748b">Cocapn</a></div>
</div></body></html>`;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path === '/health') return json({ status: 'ok', vessel: 'context-compactor' });
    if (path === '/vessel.json') return json({
      name: 'context-compactor', type: 'cocapn-vessel', version: '1.0.0',
      description: 'Text compression utility for fleet vessels — extractive, sliding window, keyphrase',
      fleet: 'https://the-fleet.casey-digennaro.workers.dev',
      capabilities: ['extractive-compress', 'sliding-window', 'keyphrase-extract', 'no-external-api']
    });

    if (path === '/api/compact' && request.method === 'POST') {
      const { text, strategy = 'extractive', ratio = 0.3, windowSize = 500 } = await request.json();
      if (!text) return json({ error: 'text required' }, 400);

      const inputLen = text.length;
      let result: any;

      switch (strategy) {
        case 'extractive':
          result = extractive(text, ratio);
          break;
        case 'sliding':
          result = slidingWindow(text, windowSize);
          break;
        case 'keyphrase':
          result = keyphrase(text, Math.ceil(10 * ratio));
          break;
        default:
          result = extractive(text, ratio);
      }

      // Cache result
      const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
      const hex = Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
      const cacheKey = `cache:${hex.substring(0, 16)}`;
      const cached = await env.COMPACTOR_KV.get(cacheKey);
      if (!cached) {
        await env.COMPACTOR_KV.put(cacheKey, JSON.stringify(result), { expirationTtl: 86400 });
      }

      return json({ ...result, strategy, inputLength: inputLen, outputLength: result.compacted.length, compressionRatio: result.compacted.length / inputLen });
    }

    return new Response(getLanding(), { headers: { 'Content-Type': 'text/html;charset=UTF-8', ...CSP } });
  }
};
