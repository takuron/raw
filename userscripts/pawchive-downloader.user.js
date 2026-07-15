// ==UserScript==
// @name         Pawchive 批量打包下载
// @namespace    https://pawchive.st/
// @version      1.0.0
// @description  抓取 Pawchive 文章正文与原图，打包为 zip 下载
// @updateURL    https://raw.takuron.com/userscripts/pawchive-downloader.meta.js
// @downloadURL  https://raw.takuron.com/userscripts/pawchive-downloader.user.js
// @match        https://pawchive.st/*/user/*/post/*
// @match        https://pawchive.pw/*/user/*/post/*
// @require      https://update.greasyfork.org/scripts/518632/1489865/jszip-min-js.js
// @require      https://update.greasyfork.org/scripts/498746/1399668/FileSaver.js
// @grant        GM_xmlhttpRequest
// @connect      file.pawchive.pw
// @connect      file.pawchive.st
// @connect      img.pawchive.pw
// @connect      img.pawchive.st
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  const RETRY = 2;

  function sanitize(name) {
    return name.replace(/[\\/:*?"<>|]/g, '').replace(/\s+/g, '_');
  }

  function parseMeta() {
    const parts = location.pathname.split('/').filter(Boolean);
    // ['', 'fanbox', 'user', '60533004', 'post', '12192296']
    const service = parts[0] || 'unknown';
    const id = parts[5] || parts[parts.length - 1] || 'unknown';

    const titleEl = document.querySelector('h1.post__title span');
    let title = titleEl ? titleEl.textContent.trim() : 'untitled';
    title = sanitize(title);

    const authorEl = document.querySelector('.post__user-name');
    const author = authorEl ? authorEl.textContent.trim() : '';

    let published = '';
    const pubEl = document.querySelector('.post__published');
    if (pubEl) {
      published = pubEl.textContent.replace(/\s+/g, ' ').trim();
    }

    const contentParas = [...document.querySelectorAll('.post__content > p')];
    const content = contentParas.map(p => p.innerText).join('\n\n');

    const files = [...document.querySelectorAll('a.fileThumb')].map(a => ({
      url: a.href,
      name: a.getAttribute('download') || a.href.split('/').pop(),
    }));

    return { service, id, title, author, published, content, url: location.href, files };
  }

  function fetchBlob(url) {
    return new Promise((resolve, reject) => {
      let attempts = 0;
      const tryOnce = () => {
        GM_xmlhttpRequest({
          method: 'GET',
          url,
          headers: { referer: location.origin },
          overrideMimeType: 'text/plain; charset=x-user-defined',
          timeout: 30000,
          onload: res => {
            if (res.status === 200) {
              const text = res.responseText;
              const data = new Uint8Array(text.length);
              for (let i = 0; i < text.length; i++) data[i] = text.charCodeAt(i);
              resolve(data);
            } else if (attempts < RETRY) { attempts++; tryOnce(); }
            else reject(new Error('HTTP ' + res.status + ' @ ' + url));
          },
          onerror: () => {
            if (attempts < RETRY) { attempts++; tryOnce(); }
            else reject(new Error('network error @ ' + url));
          },
          ontimeout: () => {
            if (attempts < RETRY) { attempts++; tryOnce(); }
            else reject(new Error('timeout @ ' + url));
          },
        });
      };
      tryOnce();
    });
  }

  // ---------- UI ----------
  function buildUI() {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = '📦 打包下载';
    btn.style.cssText = 'margin-left:0.5rem;padding:0.25rem 0.6rem;cursor:pointer;border-radius:4px;border:1px solid #888;background:#222;color:#fff;font-size:0.9rem;';

    const status = document.createElement('span');
    status.style.cssText = 'margin-left:0.5rem;font-size:0.85rem;color:#aaa;';

    const wrap = document.createElement('span');
    wrap.appendChild(btn);
    wrap.appendChild(status);

    const actions = document.querySelector('.post__actions');
    if (actions) actions.appendChild(wrap);
    else document.querySelector('.post__header').appendChild(wrap);

    return { btn, status };
  }

  // ---------- 主流程 ----------
  async function run(statusEl) {
    const meta = parseMeta();
    if (!meta.files.length) {
      statusEl.textContent = '⚠️ 未发现可下载的图片';
      return;
    }
    statusEl.textContent = `准备下载 ${meta.files.length} 张图片…`;

    const zip = new JSZip();
    const pkgName = `[${meta.service}][${meta.id}]${meta.title}.zip`;
    let successCount = 0;
    let failCount = 0;

    for (let i = 0; i < meta.files.length; i++) {
      const f = meta.files[i];
      const idx = String(i + 1).padStart(4, '0');
      try {
        const data = await fetchBlob(f.url);
        const ext = (f.name.match(/\.[a-zA-Z0-9]+$/) || ['.bin'])[0];
        const base = sanitize(f.name.replace(/\.[a-zA-Z0-9]+$/, ''));
        zip.file(`${idx}_${base}${ext}`, data, { binary: true });
        successCount++;
      } catch (err) {
        failCount++;
      }
      statusEl.textContent = `抓取中 ${successCount + failCount}/${meta.files.length}`;
    }

    if (successCount === 0) {
      statusEl.textContent = '❌ 全部图片抓取失败';
      return;
    }
    if (failCount > 0) {
      alert(`有 ${failCount} 张图片获取失败，仅打包成功部分。`);
    }

    const info = [
      `Title: ${meta.title}`,
      `Author: ${meta.author}`,
      `Service: ${meta.service}`,
      `ID: ${meta.id}`,
      `Published: ${meta.published}`,
      `URL: ${meta.url}`,
      `Images: ${successCount}/${meta.files.length}`,
      '',
      '---- Content ----',
      meta.content || '(none)',
    ].join('\n');
    zip.file('info.txt', info);

    statusEl.textContent = '打包中 0%';
    try {
      const content = await zip.generateAsync(
        { type: 'blob', compression: 'STORE' },
        (metadata) => { statusEl.textContent = `打包中 ${metadata.percent.toFixed(0)}%`; }
      );
      saveAs(content, pkgName);
      statusEl.textContent = `✅ 完成：${pkgName}`;
    } catch (err) {
      statusEl.textContent = '❌ 打包失败';
    }
  }

  // ---------- 启动 ----------
  function init() {
    if (!document.querySelector('section.site-section--post')) return;
    const { btn, status } = buildUI();
    btn.addEventListener('click', () => {
      btn.disabled = true;
      run(status).catch(e => {
        status.textContent = '❌ 出错：' + (e.message || e);
      }).finally(() => { btn.disabled = false; });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
