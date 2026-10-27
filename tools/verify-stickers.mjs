#!/usr/bin/env node
/**
 * 表情包自检（零依赖 ESM）：node tools/verify-stickers.mjs
 *
 * 校验 assets/stickers/default/manifest.json 与同目录图片：
 *  ① file 存在  ② bytes 与磁盘一致且 < 1MB  ③ width/height 与文件头一致
 *  ④ id 唯一    ⑤ mood/scene 取值合法        ⑥ meaning 长度 8~30
 *  ⑦ 每张都有 width/height/bytes
 * 另附带 schema 软校验（tags/weight/pack/source）与整体体积 < 3MB。
 */
import { readFileSync, existsSync, statSync, readdirSync } from 'node:fs';
import { dirname, join, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PACK_DIR = join(ROOT, 'assets', 'stickers', 'default');
const MANIFEST = join(PACK_DIR, 'manifest.json');

const MOODS = new Set(['calm', 'happy', 'excited', 'shy', 'sad', 'hurt', 'annoyed', 'angry', 'surprised', 'bored']);
const SCENES = new Set(['done', 'praise', 'success', 'greet', 'thanks', 'question', 'no', 'comfort', 'night', 'food', 'bored', 'idle']);
const EXPECTED_COUNT = 14;
const MAX_FILE_BYTES = 1024 * 1024;
const MAX_PACK_BYTES = 3 * 1024 * 1024;

/** 从 WebP / PNG 文件头解析真实像素尺寸（不引任何依赖）。 */
function readImageSize(buf, file) {
  const fail = (msg) => { throw new Error(file + ': ' + msg); };
  if (buf.length >= 24 && buf.toString('ascii', 1, 4) === 'PNG' && buf[0] === 0x89) {
    if (buf.toString('ascii', 12, 16) !== 'IHDR') fail('PNG 缺少 IHDR');
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20), kind: 'PNG' };
  }
  if (buf.length < 30) fail('文件太小，不像 WebP');
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WEBP') {
    fail('不是 WebP（缺少 RIFF/WEBP 头）');
  }
  const riffEnd = Math.min(buf.readUInt32LE(4) + 8, buf.length);
  let off = 12;
  while (off + 8 <= riffEnd) {
    const fourcc = buf.toString('ascii', off, off + 4);
    const chunkSize = buf.readUInt32LE(off + 4);
    const data = off + 8;
    if (fourcc === 'VP8X') {
      if (data + 10 > buf.length) fail('VP8X 数据截断');
      return { width: 1 + buf.readUIntLE(data + 4, 3), height: 1 + buf.readUIntLE(data + 7, 3), kind: 'VP8X' };
    }
    if (fourcc === 'VP8 ') {
      if (data + 10 > buf.length) fail('VP8 数据截断');
      if (buf[data + 3] !== 0x9d || buf[data + 4] !== 0x01 || buf[data + 5] !== 0x2a) fail('VP8 起始码非法');
      return {
        width: buf.readUInt16LE(data + 6) & 0x3fff,
        height: buf.readUInt16LE(data + 8) & 0x3fff,
        kind: 'VP8',
      };
    }
    if (fourcc === 'VP8L') {
      if (data + 5 > buf.length) fail('VP8L 数据截断');
      if (buf[data] !== 0x2f) fail('VP8L 签名非法');
      const bits = buf.readUInt32LE(data + 1);
      return { width: 1 + (bits & 0x3fff), height: 1 + ((bits >>> 14) & 0x3fff), kind: 'VP8L' };
    }
    off = data + chunkSize + (chunkSize & 1);
  }
  fail('未找到 VP8/VP8L/VP8X 图像块');
}

const problems = [];
const check = (cond, msg) => { if (!cond) problems.push(msg); };
const codePoints = (s) => [...s].length;

if (!existsSync(MANIFEST)) {
  console.error('❌ 找不到 ' + relative(ROOT, MANIFEST));
  process.exit(1);
}

let manifest;
try {
  manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
} catch (err) {
  console.error('❌ manifest.json 不是合法 JSON: ' + err.message);
  process.exit(1);
}

const stickers = Array.isArray(manifest.stickers) ? manifest.stickers : [];
check(stickers.length > 0, 'manifest.stickers 必须是非空数组');
check(manifest?.pack?.id === 'default', 'pack.id 必须是 "default"');
check(typeof manifest?.pack?.name === 'string' && manifest.pack.name.length > 0, 'pack.name 缺失');
check(manifest?.pack?.version === 1, 'pack.version 必须是 1');
check(typeof manifest?.source?.artist === 'string' && manifest.source.artist.length > 0, 'source.artist 缺失');
check(manifest?.source?.aiAssisted === false, 'source.aiAssisted 必须是 false');

const seenIds = new Set();
const seenFiles = new Set();
let totalBytes = 0;
const rows = [];

for (let i = 0; i < stickers.length; i++) {
  const s = stickers[i];
  const at = 'stickers[' + i + ']' + (s && s.id ? ' (' + s.id + ')' : '');
  if (!s || typeof s !== 'object') { problems.push(at + ': 不是对象'); continue; }

  // id
  if (typeof s.id !== 'string' || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(s.id)) {
    problems.push(at + ': id 必须是小写 kebab-case');
  } else {
    check(!seenIds.has(s.id), at + ': id 重复 "' + s.id + '"');
    seenIds.add(s.id);
  }

  // ⑦ 必备字段
  check(typeof s.width === 'number' && Number.isInteger(s.width) && s.width > 0, at + ': width 缺失或非法');
  check(typeof s.height === 'number' && Number.isInteger(s.height) && s.height > 0, at + ': height 缺失或非法');
  check(typeof s.bytes === 'number' && Number.isInteger(s.bytes) && s.bytes > 0, at + ': bytes 缺失或非法');
  check(typeof s.file === 'string' && s.file.length > 0, at + ': file 缺失');
  check(typeof s.name === 'string' && s.name.length > 0, at + ': name 缺失');

  // ⑥ meaning 8~30 字
  if (typeof s.meaning !== 'string') {
    problems.push(at + ': meaning 缺失');
  } else {
    const len = codePoints(s.meaning);
    check(len >= 8 && len <= 30, at + ': meaning 长度 ' + len + ' 超出 8~30（"' + s.meaning + '"）');
  }

  // ⑤ mood / scene 合法
  if (!Array.isArray(s.mood) || s.mood.length === 0) {
    problems.push(at + ': mood 必须是非空数组');
  } else {
    for (const m of s.mood) {
      if (!MOODS.has(m)) problems.push(at + ': 非法 mood "' + m + '"（允许: ' + [...MOODS].join('/') + '）');
    }
  }
  if (!Array.isArray(s.scene) || s.scene.length === 0) {
    problems.push(at + ': scene 必须是非空数组');
  } else {
    check(s.scene.length >= 1 && s.scene.length <= 3, at + ': scene 必须是 1~3 个');
    for (const sc of s.scene) {
      if (!SCENES.has(sc)) problems.push(at + ': 非法 scene "' + sc + '"（允许: ' + [...SCENES].join('/') + '）');
    }
  }

  // tags / weight 软校验
  if (Array.isArray(s.tags)) {
    check(s.tags.length <= 8, at + ': tags 超过 8 个');
    for (const t of s.tags) {
      check(typeof t === 'string' && codePoints(t) >= 1 && codePoints(t) <= 8, at + ': tag "' + t + '" 超过 8 字');
    }
  } else {
    problems.push(at + ': tags 缺失');
  }
  check(typeof s.weight === 'number' && s.weight >= 1 && s.weight <= 5, at + ': weight 必须是 1~5');

  if (typeof s.file !== 'string' || s.file.length === 0) continue;
  if (s.file !== s.id + '.webp') problems.push(at + ': file 应为 "' + s.id + '.webp"，实际 "' + s.file + '"');
  check(!seenFiles.has(s.file), at + ': file 重复 "' + s.file + '"');
  seenFiles.add(s.file);
  check(!s.file.includes('/') && !s.file.includes('\\'), at + ': file 不能带路径');

  // ① file 存在
  const abs = join(PACK_DIR, s.file);
  if (!existsSync(abs)) { problems.push(at + ': 文件不存在 ' + relative(ROOT, abs)); continue; }

  let buf;
  try { buf = readFileSync(abs); } catch (err) { problems.push(at + ': 无法读取 ' + s.file + ' (' + err.message + ')'); continue; }

  // ② bytes 与磁盘一致且 < 1MB
  const diskBytes = statSync(abs).size;
  totalBytes += diskBytes;
  check(s.bytes === diskBytes, at + ': bytes 记录 ' + s.bytes + ' 与磁盘 ' + diskBytes + ' 不一致');
  check(diskBytes < MAX_FILE_BYTES, at + ': 文件 ' + diskBytes + ' 字节，超过 1MB');

  // ③ 宽高与文件头一致
  let size;
  try { size = readImageSize(buf, s.file); } catch (err) { problems.push(at + ': ' + err.message); continue; }
  check(size.width === s.width && size.height === s.height,
    at + ': 尺寸不符，manifest ' + s.width + 'x' + s.height + '，文件头 ' + size.width + 'x' + size.height);
  check(s.height === 300, at + ': 高度应为 300，实际 ' + s.height);

  rows.push({ id: s.id, size: size.width + 'x' + size.height, bytes: diskBytes, kind: size.kind });
}

check(totalBytes < MAX_PACK_BYTES, '整个表情包 ' + (totalBytes / 1048576).toFixed(2) + 'MB，超过 3MB');
check(stickers.length === EXPECTED_COUNT, '贴纸数量 ' + stickers.length + '，期望 ' + EXPECTED_COUNT);

// 反向检查：目录里有没有 manifest 未登记的多余图片
if (existsSync(PACK_DIR)) {
  for (const f of readdirSync(PACK_DIR)) {
    if (f === 'manifest.json' || f === 'preview.png' || f.startsWith('_') || f.startsWith('.')) continue;
    if (/\.(webp|png|avif|jpg|jpeg)$/i.test(f) && !seenFiles.has(f)) {
      problems.push('目录里有多余图片未登记到 manifest: ' + f);
    }
  }
}

if (problems.length > 0) {
  console.error('❌ 表情包校验失败（' + problems.length + ' 个问题）:');
  for (const p of problems) console.error('  - ' + p);
  process.exit(1);
}

for (const r of rows) {
  console.log('  ' + r.id.padEnd(10) + ' ' + r.size.padEnd(8) + ' ' + (r.bytes / 1024).toFixed(1).padStart(6) + 'KB  ' + r.kind);
}
console.log('总计 ' + rows.length + ' 张 / ' + (totalBytes / 1024).toFixed(1) + 'KB（上限 ' + (MAX_PACK_BYTES / 1048576) + 'MB）');
console.log('✅ ' + rows.length + '/' + EXPECTED_COUNT + ' stickers ok');
