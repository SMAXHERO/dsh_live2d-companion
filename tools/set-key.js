#!/usr/bin/env node
/* 换 key / 检查 key —— 大肥鱼
 *
 * 用法：
 *   node tools/set-key.js            交互式换 key（输入不回显，先联网验证再落盘）
 *   node tools/set-key.js --check    只检查现在的 key 还能不能用，不改任何文件
 *   node tools/set-key.js --env      从环境变量 DEEPSEEK_API_KEY 读（自动化用）
 * 可选参数：
 *   --notest      跳过联网验证直接写（不推荐）
 *   --backup      把旧配置留一份 config.local.json.bak（里面有旧 key，处理完记得删）
 *   --file <路径>  写到别的配置文件（测试用）
 *
 * 设计原则：key 只在你的终端里出现一次，不进聊天、不进网页、不进日志；
 * 写入前先用一次 1 token 的请求确认它真的能用，避免把服务写挂。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const ROOT = path.resolve(__dirname, '..');
const argv = process.argv.slice(2);
const has = (n) => argv.indexOf('--' + n) >= 0;
const val = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };

const FILE = path.resolve(val('file', path.join(ROOT, 'config.local.json')));
const EXAMPLE = path.join(ROOT, 'config.local.example.json');
const CHECK_ONLY = has('check');
const FROM_ENV = has('env');
const SKIP_TEST = has('notest');
const KEEP_BACKUP = has('backup');
const KEY_RE = /^sk-[A-Za-z0-9_\-]{16,}$/;

function mask(k) {
  k = String(k || '');
  return k ? k.slice(0, 3) + '…' + k.slice(-4) + '（' + k.length + ' 位）' : '(没有)';
}
function readJSON(p) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return null; } }

// 允许直接粘整行：Authorization: Bearer sk-xxx / "sk-xxx" / 带空格的
function clean(s) {
  s = String(s || '').trim().replace(/^["']|["']$/g, '').trim();
  const m = s.match(/sk-[A-Za-z0-9_\-]{8,}/);
  return m ? m[0] : s.trim();
}

// 管道/重定向输入时：启动就把 stdin 一次读空，之后每次提问从队列里取一行。
// （多次 createInterface 会丢行，这样测起来才可靠，也方便脚本化调用。）
let QUEUE = null;
function initQueue() {
  if (process.stdin.isTTY) return Promise.resolve();
  return new Promise((resolve) => {
    let buf = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (d) => { buf += d; });
    process.stdin.on('end', () => { QUEUE = buf.split(/\r?\n/); resolve(); });
    process.stdin.on('error', () => { QUEUE = []; resolve(); });
    process.stdin.resume();
  });
}
function nextLine() { return QUEUE && QUEUE.length ? QUEUE.shift() : ''; }

function ask(question) {
  if (QUEUE) { const v = String(nextLine()).trim(); console.log(question + v); return Promise.resolve(v); }
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    let done = false;
    const finish = (v) => { if (done) return; done = true; rl.close(); resolve(v); };
    rl.question(question, (a) => finish(String(a || '').trim()));
    rl.on('close', () => finish(''));
  });
}

// 隐藏输入：终端里只显示 *，粘完回车即可
function hidden(question) {
  const stdin = process.stdin, stdout = process.stdout;
  if (!stdin.isTTY || QUEUE) return Promise.resolve(nextLine());
  return new Promise((resolve) => {
    stdout.write(question);
    stdin.setRawMode(true); stdin.resume(); stdin.setEncoding('utf8');
    let buf = '';
    const onData = (chunk) => {
      const s = String(chunk);
      for (let i = 0; i < s.length; i++) {
        const c = s[i];
        if (c === '\r' || c === '\n' || c === '\u0004') return finish();
        if (c === '\u0003') { stdout.write('\n已取消，什么都没改。\n'); process.exit(130); }
        if (c === '\u007f' || c === '\b') { if (buf) { buf = buf.slice(0, -1); stdout.write('\b \b'); } continue; }
        buf += c; stdout.write('*');
      }
    };
    function finish() {
      stdin.setRawMode(false); stdin.pause(); stdin.removeListener('data', onData);
      stdout.write('\n'); resolve(buf);
    }
    stdin.on('data', onData);
  });
}

async function testKey(key, cfg) {
  const base = String(cfg.baseUrl || 'https://api.deepseek.com/v1').replace(/\/+$/, '');
  const model = cfg.model || 'deepseek-flash';
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 15000);
  try {
    const r = await fetch(base + '/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
      body: JSON.stringify({ model, messages: [{ role: 'user', content: 'ping' }], max_tokens: 1, stream: false }),
      signal: ctl.signal
    });
    const txt = await r.text();
    if (r.status === 200) return { ok: true, msg: '可用（' + model + ' 正常回话）' };
    if (r.status === 401) return { ok: false, msg: '401：key 无效或已被删除' };
    if (r.status === 402) return { ok: true, warn: true, msg: '402：key 有效，但账户余额不足' };
    if (r.status === 429) return { ok: true, warn: true, msg: '429：key 有效，但被限流（稍后再试）' };
    return { ok: false, msg: r.status + '：' + txt.replace(/\s+/g, ' ').slice(0, 180) };
  } catch (e) {
    return { ok: false, msg: (e && e.name === 'AbortError') ? '测试超时（15 秒没响应）' : '联网失败：' + ((e && e.message) || e) };
  } finally {
    clearTimeout(timer);
  }
}

(async function main() {
  await initQueue();
  const old = readJSON(FILE);
  const cfg = old || readJSON(EXAMPLE) || { baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-flash' };
  console.log('');
  console.log('配置文件：' + FILE);
  console.log('现有 key：' + mask(old && old.apiKey));
  if (process.env.DEEPSEEK_API_KEY) console.log('环境变量：DEEPSEEK_API_KEY = ' + mask(process.env.DEEPSEEK_API_KEY) + '（优先级：文件 > 环境变量）');
  console.log('模型：' + (cfg.model || 'deepseek-flash'));

  if (CHECK_ONLY) {
    const k = (old && old.apiKey) || process.env.DEEPSEEK_API_KEY || '';
    if (!k) { console.log('\n还没配 key。双击 换key.bat 或跑 node tools/set-key.js。'); process.exit(1); }
    process.stdout.write('\n验证 ' + mask(k) + ' … ');
    const t = await testKey(k, cfg);
    console.log(t.ok ? ('✅ ' + t.msg) : ('❌ ' + t.msg));
    process.exit(t.ok ? 0 : 1);
  }

  let key = '';
  if (FROM_ENV) {
    key = clean(process.env.DEEPSEEK_API_KEY || '');
  } else {
    console.log('');
    console.log('把新 key 粘在下面回车（不回显，只显示 *；Ctrl+C 取消）。');
    console.log('还没有？这个页面能生成：https://platform.deepseek.com/api_keys');
    key = clean(await hidden('\n新 key: '));
  }
  if (!key) { console.log('没输入，什么都没改。'); process.exit(0); }

  if (!KEY_RE.test(key)) {
    console.log('');
    console.log('⚠ 这不像 DeepSeek 的 key（应形如 sk- 加 32 位字母数字）。你给的是：' + mask(key));
    if (!/^y/i.test(await ask('仍然写入吗？[y/N] '))) { console.log('已放弃，什么都没改。'); process.exit(1); }
  }
  if (old && old.apiKey && key === old.apiKey) console.log('\n⚠ 和现在的 key 一模一样（可能只是重复粘了一次）。');

  if (!SKIP_TEST) {
    process.stdout.write('\n联网验证新 key … ');
    const t = await testKey(key, cfg);
    console.log(t.ok ? ('✅ ' + t.msg) : ('❌ ' + t.msg));
    if (!t.ok) { console.log('验证没过，文件没动。'); process.exit(1); }
    if (t.warn && !/^y/i.test(await ask('上面是警告（key 本身有效）。仍要写入？[y/N] '))) {
      console.log('已放弃，什么都没改。'); process.exit(1);
    }
  } else {
    console.log('\n（已跳过联网验证）');
  }

  const next = Object.assign({}, cfg);
  next.apiKey = key;
  const tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2) + '\n', 'utf8');
  if (KEEP_BACKUP && old) fs.writeFileSync(FILE + '.bak', JSON.stringify(old, null, 2) + '\n', 'utf8');
  fs.renameSync(tmp, FILE);

  console.log('');
  console.log('✅ 已写入 ' + FILE);
  console.log('   新 key：' + mask(key) + (KEEP_BACKUP ? '  （旧文件在 config.local.json.bak，里面有旧 key，记得删）' : ''));
  console.log('   代理每个请求都重读这个文件 → 不用重启服务，刷新网页就生效。');
  console.log('   收尾：回 https://platform.deepseek.com/api_keys 把旧 key 删掉。');
})().catch((e) => { console.log('\n出错了：' + ((e && e.message) || e)); process.exit(1); });
