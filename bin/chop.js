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

      let lastUserMsg = '';
      try {
        const lines = readFileSync(filePath, 'utf8').split('\n');
        for (const line of lines) {
          if (!line) continue;
          try {
            const r = JSON.parse(line);
            if (r.type === 'user') {
              const content = r.message?.content;
              if (Array.isArray(content)) {
                // skip if contains any tool results or images — not human-typed text
                if (content.some(b => b.type === 'tool_result' || b.type === 'image')) continue;
              }
              const text = typeof content === 'string' ? content :
                (Array.isArray(content) ? (content.find(b => b.type === 'text')?.text || '') : '') || '';
              const cleaned = text.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
              if (!cleaned
                || cleaned.startsWith('[Image:')
                || cleaned.startsWith('[Request interrupted')
                || /^[a-z0-9]+ toolu_/.test(cleaned)
                || /^https?:\/\/\S+$/.test(cleaned)
              ) continue;
              lastUserMsg = cleaned;
            }
          } catch {}
        }
      } catch {}

      const rawT = lastUserMsg.slice(0, 120);
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

function formatRow(s, i, pad, selected) {
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
  const projLabel = `${projRaw} (${dt})`;
  const pad2 = ' '.repeat(Math.max(0, 34 - projLabel.length));
  const t = s.title ? s.title.slice(0, 40) + (s.title.length > 40 ? '…' : '') : '';
  const cursor = selected ? `${c.orange}›${c.reset}` : ' ';
  const num = selected
    ? `${c.orange}${c.bold}${String(i+1).padStart(pad)}${c.reset}`
    : `${c.white}${String(i+1).padStart(pad)}${c.reset}`;
  const projStr = selected
    ? `${c.bold}${c.white}${projRaw}${c.reset}${c.gray} (${dt})${c.reset}${pad2}`
    : `\x1b[38;5;248m${projRaw}${c.reset}${c.dim} (${dt})${c.reset}${pad2}`;
  const titleStr = selected
    ? `${c.bold}${c.white}${t || '(untitled)'}${c.reset}`
    : t ? `\x1b[38;5;246m${t}${c.reset}` : `${c.dim}(untitled)${c.reset}`;
  return `\r\x1b[2K ${cursor} ${num}  ${projStr}  ${titleStr}`;
}

function resumeAllProjects() {
  const sessions = loadSessions();
  if (!sessions.length) { claude(['--resume']); return; }

  const pad = String(sessions.length).length;
  let selected = 0;

  process.stdout.write('\n');
  process.stdout.write(`  ${c.orange}${c.bold}(\\ /)${c.reset}\n`);
  process.stdout.write(`  ${c.orange}${c.bold}(^.^)${c.reset}  ${c.orange}${c.bold}claude hop${c.reset}  ${c.gray}·  chop  ·  ${sessions.length} recent sessions${c.reset}\n\n`);

  const EXTRA = 2; // blank line + hint line

  function render(firstRender) {
    if (!firstRender) process.stdout.write(`\x1b[${sessions.length + EXTRA}A`);
    sessions.forEach((s, i) => process.stdout.write(formatRow(s, i, pad, i === selected) + '\n'));
    process.stdout.write(`\r\x1b[2K\n\r\x1b[2K  ${c.dim}enter number or arrow keys to select, q or esc to exit${c.reset}\n`);
  }

  render(true);

  let numBuf = '';

  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding('utf8');

  process.stdin.on('data', key => {
    if (key === '\x1b[A') {
      numBuf = '';
      selected = Math.max(0, selected - 1);
      render(false);
    } else if (key === '\x1b[B') {
      numBuf = '';
      selected = Math.min(sessions.length - 1, selected + 1);
      render(false);
    } else if (/^\d$/.test(key)) {
      numBuf += key;
      const idx = parseInt(numBuf, 10) - 1;
      if (idx >= 0 && idx < sessions.length) {
        selected = idx;
        // launch immediately if no larger valid number could follow
        const maxStart = Math.floor(sessions.length / 10);
        if (parseInt(numBuf, 10) > maxStart || numBuf.length > 1) {
          process.stdout.write('\n');
          process.stdin.setRawMode(false);
          process.stdin.pause();
          const entry = sessions[selected];
          const cwd = decodePath(entry.projDir) || process.cwd();
          claude(['--resume', entry.sessionId], cwd);
          return;
        }
        render(false);
      } else if (parseInt(numBuf, 10) > sessions.length) {
        numBuf = key;
        const i2 = parseInt(numBuf, 10) - 1;
        if (i2 >= 0 && i2 < sessions.length) { selected = i2; render(false); }
      }
    } else if (key === '\r') {
      process.stdout.write('\n');
      process.stdin.setRawMode(false);
      process.stdin.pause();
      const entry = sessions[selected];
      const cwd = decodePath(entry.projDir) || process.cwd();
      claude(['--resume', entry.sessionId], cwd);
    } else if (key === '\x03' || key === '\x1b' || key === 'q') {
      process.stdout.write('\n');
      process.stdin.setRawMode(false);
      process.exit(0);
    }
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
