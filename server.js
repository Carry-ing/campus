'use strict';

/**
 * 校园体验页 —— 零依赖 Node 静态服务
 *
 *   node server.js                 # 默认 5180 端口，监听 0.0.0.0（同局域网可直接访问）
 *   $env:PORT=8080; node server.js # 换端口（Windows PowerShell）
 *
 * 只做一件事：把 campus/ 目录里的静态页面发给浏览器。
 * 页面本身没有任何后端依赖，所以这个文件也可以完全不用——用任何静态服务器托管 campus/ 都行。
 */

const http = require('http');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const os = require('os');

const PORT = Number(process.env.PORT) || 5180;
const HOST = process.env.HOST || '0.0.0.0';
const ROOT = __dirname;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8'
};

function sendText(res, status, text) {
  const body = Buffer.from(text, 'utf8');
  res.writeHead(status, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Content-Length': body.length,
    'Cache-Control': 'no-store'
  });
  res.end(body);
}

async function sendFile(req, res, full) {
  try {
    const stat = await fsp.stat(full);
    if (stat.isDirectory()) throw new Error('is directory');

    // 页面 / 样式 / 脚本改动频繁，用 ETag 协商缓存，刷新就能看到最新版本
    const etag = `W/"${stat.size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}"`;
    if (req.headers['if-none-match'] === etag) {
      res.writeHead(304, { ETag: etag, 'Cache-Control': 'no-cache' });
      return res.end();
    }

    res.writeHead(200, {
      'Content-Type': MIME[path.extname(full).toLowerCase()] || 'application/octet-stream',
      'Content-Length': stat.size,
      ETag: etag,
      'Cache-Control': 'no-cache'
    });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(full).pipe(res);
  } catch {
    sendText(res, 404, '404 Not Found');
  }
}

const server = http.createServer(async (req, res) => {
  const urlPath = (req.url || '/').split('?')[0];

  if (urlPath === '/api/health') {
    const body = Buffer.from(JSON.stringify({ ok: true, time: new Date().toISOString() }), 'utf8');
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': body.length, 'Cache-Control': 'no-store' });
    return res.end(body);
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return sendText(res, 405, 'Method Not Allowed');
  }

  let rel = decodeURIComponent(urlPath);
  if (rel === '/' || rel === '') rel = '/index.html';
  rel = rel.replace(/^[/\\]+/, '');

  const full = path.join(ROOT, path.normalize(rel));
  if (!full.startsWith(ROOT)) return sendText(res, 403, 'Forbidden');

  return sendFile(req, res, full);
});

server.listen(PORT, HOST, () => {
  console.log(`校园体验页已启动 → http://localhost:${PORT}`);

  const lan = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const item of list || []) {
      if (item.family === 'IPv4' && !item.internal) lan.push(item.address);
    }
  }
  if (lan.length) {
    console.log('同一个局域网（同一个 WiFi）里可以用这些地址访问：');
    for (const ip of lan) console.log(`   http://${ip}:${PORT}`);
  } else {
    console.log('没有检测到局域网地址，只能用 localhost 访问。');
  }
  console.log('不同局域网（4G/5G、别人家的宽带）访问：见 README.md 的「公网访问」一节。');
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`端口 ${PORT} 已被占用，换一个：$env:PORT=8081; node server.js`);
  } else {
    console.error('服务启动失败：', err);
  }
  process.exit(1);
});
