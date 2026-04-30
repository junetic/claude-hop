#!/usr/bin/env node

const { spawnSync } = require('child_process');
const { readFileSync, writeFileSync, existsSync, readdirSync, statSync } = require('fs');
const { homedir } = require('os');
const path = require('path');
const readline = require('readline');

const STORE = path.join(homedir(), '.chop.json');
const PROJ_DIR = path.join(homedir(), '.claude', 'projects');

function load() {
  if (!existsSync(STORE)) return {};
  try { return JSON.parse(readFileSync(STORE, 'utf8')); }
  catch { return {}; }
}

function save(store) {
  writeFileSync(STORE, JSON.stringify(store, null, 2));
}

function claude(args, cwd) {
  const result = spawnSync('claude', args, { stdio: 'inherit', cwd: cwd || process.cwd() });
  process.exit(result.status ?? 0);
}

// Decode encoded project path (e.g. '-Users-junetic-works-foo-bar' → '/Users/junetic/works/foo-bar')
// by greedily matching longest existing directory at each level
function decodePath(encoded) {
  const parts = encoded.replace(/^-/, '').split('-').filter(Boolean);
  function find(remaining, current) {
    if (!remaining.length) return current;
    for (let n = remaining.length; n >= 1; n--) {
      const name = remaining.slice(0, n).join('-');
      const candidate = path.join(current, name);
      if (existsSync(candidate)) {
        const result = find(remaining.slice(n), candidate);
        if (result) return result;
      }
    }
    return null;
  }
  return find(parts, '/');
}

const c = {
  reset:  '\x1b[0m',
  bold:   '\x1b[1m',
  dim:    '\x1b[2m',
  orange: '\x1b[38;5;214m',
  white:  '\x1b[38;5;255m',
  gray:   '\x1b[38;5;244m',
};

function loadSessions() {
  if (!existsSync(PROJ_DIR)) return [];
  const sessions = [];

  for (const projDir of readdirSync(PROJ_DIR)) {
    const projPath = path.join(PROJ_DIR, projDir);
    if (!statSync(projPath).isDirectory()) continue;

    for (const file of readdirSync(projPath)) {
      if (!file.endsWith('.jsonl')) continue;
      const sessionId = file.replace('.jsonl', '');
      const filePath = path.join(projPath, file);
      const mtime = statSync(filePath).mtimeMs;

      let title = '';
      let fallback = '';
      try {
        const lines = readFileSync(filePath, 'utf8').split('\n');
        for (const line of lines) {
          if (!line) continue;
          try {
            const r = JSON.parse(line);
            if (r.type === 'ai-title' && r.aiTitle) { title = r.aiTitle; break; }
            if (!fallback && r.type === 'user') {
              const content = r.message?.content;
              const text = typeof content === 'string' ? content :
                (Array.isArray(content) ? content.find(b => b.type === 'text')?.text : '') || '';
              const cleaned = text.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
              if (cleaned) fallback = cleaned.slice(0, 120);
            }
          } catch {}
        }
      } catch {}

      const rawT = (title || fallback).replace(/\s+/g, ' ').trim();
      sessions.push({ mtime, sessionId, projDir, title: rawT });
    }
  }

  return sessions.sort((a, b) => b.mtime - a.mtime);
}

function displayPath(projDir) {
  const actual = decodePath(projDir);
  if (actual) return actual.replace(homedir() + '/', '');
  // fallback: strip home prefix from encoded name, keep hyphens as-is for last segment
  return projDir.replace(/^-Users-[^-]+-/, '').replace(/-/g, '/');
}

function resumeAllProjects() {
  const sessions = loadSessions();
  if (!sessions.length) { claude(['--resume']); return; }

  const pad = String(sessions.length).length;

  process.stdout.write('\n');
  process.stdout.write(`  ${c.orange}${c.bold}(\\ /)${c.reset}\n`);
  process.stdout.write(`  ${c.orange}${c.bold}(^.^)${c.reset}  ${c.orange}${c.bold}claude hop${c.reset}  ${c.gray}·  chop  ·  ${sessions.length} recent sessions${c.reset}\n\n`);

  sessions.forEach((s, i) => {
    const d = new Date(s.mtime);
    const diffMs = Date.now() - s.mtime;
    const mins = Math.floor(diffMs / 60000);
    const hrs = Math.floor(mins / 60);
    const days = Math.floor(hrs / 24);
    const dt = mins < 1 ? 'just now'
      : mins < 60 ? `${mins}m ago`
      : hrs < 24 ? `${hrs}h ago`
      : days < 7 ? `${days}d ago`
      : `${Math.floor(days/7)}w ago`;
    const projRaw = displayPath(s.projDir).slice(0, 22);
    const num = `${c.gray}${String(i+1).padStart(pad)}${c.reset}`;
    const date = `\x1b[38;5;240m${dt}${c.reset}`;
    const projLabel = `${projRaw} (${dt})`;
    const projStr = `\x1b[38;5;248m${projRaw}${c.reset}${c.dim} (${dt})${c.reset}${' '.repeat(Math.max(0, 34 - projLabel.length))}`;
    const hasAiTitle = !!s.title;
    const indicator = hasAiTitle ? `${c.orange}›${c.reset}` : `${c.dim}·${c.reset}`;
    const t = s.title ? s.title.slice(0, 40) + (s.title.length > 40 ? '…' : '') : '';
    const titleStr = t
      ? `${c.white}${t}${c.reset}`
      : `${c.dim}(untitled)${c.reset}`;
    process.stdout.write(`  ${num}  ${projStr}  ${indicator}${titleStr}\n`);
  });

  process.stdout.write('\n');
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  rl.question(`  ${c.orange}resume›${c.reset} `, answer => {
    rl.close();
    const idx = parseInt(answer, 10) - 1;
    const entry = sessions[idx];
    if (!entry) { console.error('invalid selection'); process.exit(1); }
    const cwd = decodePath(entry.projDir) || process.cwd();
    claude(['--resume', entry.sessionId], cwd);
  });
}

const [cmd, name] = process.argv.slice(2);

if (!cmd) {
  resumeAllProjects();
} else if (cmd === 'r') {
  const sessions = loadSessions();
  if (!sessions.length) { claude(['--continue']); }
  else {
    const s = sessions[0];
    const cwd = decodePath(s.projDir) || process.cwd();
    claude(['--resume', s.sessionId], cwd);
  }
} else if (cmd === 'pin') {
  if (!name) { console.error('Usage: chop pin <name>'); process.exit(1); }
  const store = load();
  store[name] = process.cwd();
  save(store);
  console.log(`pinned "${name}" → ${process.cwd()}`);
} else if (cmd === 'rm') {
  if (!name) { console.error('Usage: chop rm <name>'); process.exit(1); }
  const store = load();
  if (!store[name]) { console.error(`no session "${name}"`); process.exit(1); }
  delete store[name];
  save(store);
  console.log(`removed "${name}"`);
} else if (cmd === 'ls') {
  const store = load();
  const entries = Object.entries(store);
  if (!entries.length) { console.log('no pinned sessions — use: chop pin <name>'); }
  else entries.forEach(([n, dir]) => console.log(`${n.padEnd(16)} ${dir}`));
} else {
  const store = load();
  const dir = store[cmd];
  if (!dir) { console.error(`no session "${cmd}" — use: chop pin <name>`); process.exit(1); }
  if (!existsSync(dir)) { console.error(`directory gone: ${dir}`); process.exit(1); }
  claude(['--continue'], dir);
}
