// ==UserScript==
// @name        Pixiv 图片下载提取版 (极速打包+自定义命名)
// @namespace   https://github.com/takuron/raw
// @version     1.0.9
// @description 提取了 Pixiv Plus 脚本的图片下载功能，支持自定义命名与空格替换，图片及动图均打包为带 info.txt 的 ZIP，动图可选 GIF 或图片集。
// @author      Ahaochan Takuron
// @tag         download
// @tag         pixiv
// @tag         zip
// @updateURL   https://raw.takuron.com/userscripts/pixiv-downloader.meta.js
// @downloadURL https://raw.takuron.com/userscripts/pixiv-downloader.user.js
// @include     http*://www.pixiv.net*
// @match       http://www.pixiv.net/
// @connect     i.pximg.net
// @connect     i-f.pximg.net
// @connect     i-cf.pximg.net
// @license     GPL-3.0
// @grant       GM.xmlHttpRequest
// @require     https://update.greasyfork.org/scripts/505351/1435420/jquery%20221.js
// @require     https://update.greasyfork.org/scripts/518632/1489865/jszip-min-js.js
// @require     https://update.greasyfork.org/scripts/498746/1399668/FileSaver.js
// @require     https://greasyfork.org/scripts/2963-gif-js/code/gifjs.js?version=8596
// @require     https://greasyfork.org/scripts/375359-gm4-polyfill-1-0-1/code/gm4-polyfill-101.js?version=652238
// @run-at      document-end
// @noframes
// ==/UserScript==

jQuery($ => {
    'use strict';

    // ============================ 用户配置区 ====================================
    const USER_CONFIG = {
        // 下载的文件名及压缩包名格式
        // 可用变量: {pid} (作品ID), {uid} (作者ID), {pname} (作品名字), {uname} (作者名字)
        nameFormat: '[pixiv][{pid}]{pname}',

        // 是否将生成的名称中的所有空格替换为下划线 '_' (true: 是, false: 否)
        replaceSpaceWithUnderscore: true
    };
    // ============================================================================

    // ============================ jQuery插件 ====================================
    $.fn.extend({
        fitWindow() {
            this.css('width', 'auto').css('height', 'auto')
                .css('max-width', '').css('max-height', $(window).height());
        }
    });

    // ============================ i18n 国际化 ===============================
    const i18nLib = {
        ja: { download: 'ダウンロード' },
        en: { download: 'Download' },
        zh: { download: '下载' },
        'zh-tw': { download: '下載' }
    };
    i18nLib['zh-cn'] = Object.assign({}, i18nLib.zh);
    const lang = (document.documentElement.getAttribute('lang') || 'en').toLowerCase();
    const i18n = key => i18nLib[lang]?.[key] || i18nLib.en[key] || key;

    // ============================ 全局参数 ====================================
    let illust = {};
    const illustApi = () => {
        const urlIllustId = location.href.match(/artworks\/(\d*)(#\d*)?$/)?.[1] || '';
        if (!illust || String(illust?.illustId) !== String(urlIllustId)) {
            $.ajax({
                url: `/ajax/illust/${urlIllustId}`,
                dataType: 'json',
                async: false,
                success: ({body}) => { illust = body; },
            });
        }
        return illust;
    };

    const observerFactory = function (option) {
        const defaults = {
            callback: () => {},
            node: document.body,
            option: {childList: true, subtree: true}
        };
        let options = typeof option === 'function' ? {...defaults, callback: option} : Object.assign({}, defaults, option);
        options.node = options.node || document.body;

        const MutationObserver = window.MutationObserver || window.WebKitMutationObserver || window.MozMutationObserver;
        const observer = new MutationObserver((mutations, observer) => {
            options.callback.call(this, mutations, observer);
        });

        observer.observe(options.node, options.option);
        return observer;
    };

    // ============================ url 页面判断 ==============================
    const isArtworkPage = () => /.+artworks\/\d+.*/.test(location.href);
    const isMoreMode = () => illustApi().pageCount > 1;
    const isGifMode = () => illustApi().illustType === 2;

    // ============================ 核心功能：下载与原图 =======================
    const addImgSizeSpan = (option) => {
        const options = Object.assign({$: undefined, position: 'relative'}, option);
        const $img = options.$;
        const position = options.position;

        let $span = $img.next('span.ahao-img-size');
        if ($span.length <= 0) {
            $span = $(`<span class="ahao-img-size" style="position: ${position}; right: 0; top: 28px;
                    color: #ffffff; font-size: x-large; font-weight: bold; -webkit-text-stroke: 1.0px #000000;"></span>`);
            $img.before($span);
        }

        const tagName = $img.prop('tagName').toLowerCase();
        if (tagName === 'img') {
            const img = new Image();
            img.src = $img.attr('src');
            img.onload = function () {
                $span.text(`${this.width}x${this.height}`);
            };
        } else if (tagName === 'canvas') {
            const width = $img.attr('width') || $img.css('width').replace('px', '') || $img.css('max-width').replace('px', '') || 0;
            const height = $img.attr('height') || $img.css('height').replace('px', '') || $img.css('max-height').replace('px', '') || 0;
            $span.text(`${width}x${height}`);
        }
    };

    const addImageDownloadBtn = option => {
        const options = Object.assign({
            $shareButtonContainer: undefined, id: '', text: '', clickFun: () => {}
        }, option);
        const $downloadButtonContainer = options.$shareButtonContainer.clone();
        $downloadButtonContainer.addClass('ahao-download-btn')
            .attr('id', options.id)
            .removeClass(options.$shareButtonContainer.attr('class'))
            .css({'margin-right': '10px', 'position': 'relative', 'border': '1px solid', 'padding': '1px 10px'})
            .append(`<p style="display: inline">${options.text}</p>`);
        $downloadButtonContainer.find('button').css('transform', 'rotate(180deg)').on('click', options.clickFun);
        options.$shareButtonContainer.after($downloadButtonContainer);
        return $downloadButtonContainer;
    };

    const cleanText = html => {
        const $div = $('<div>').html(html || '');
        return $div.text().replace(/\s+/g, ' ').trim();
    };

    const getDownloadName = (info = illustApi()) => {
        let name = USER_CONFIG.nameFormat;

        name = name.replace(/\{pid\}/g, info.illustId || '')
                   .replace(/\{uid\}/g, info.userId || '')
                   .replace(/\{pname\}/g, info.illustTitle || '')
                   .replace(/\{uname\}/g, info.userName || '');

        if (USER_CONFIG.replaceSpaceWithUnderscore) {
            name = name.replace(/\s+/g, '_');
        }

        // 过滤系统非法路径字符
        name = name.replace(/[\\/:*?"<>|]/g, '');
        return name;
    };

    const addArtworkInfo = (zip, info, imageCount, totalImages, url) => {
        const tags = (Array.isArray(info.tags) ? info.tags : info.tags?.tags || [])
            .map(t => (t && (t.tag || t.name)) || '').filter(Boolean).join(', ');
        const infoTxt = [
            `Title: ${info.illustTitle || ''}`,
            `Author: ${info.userName || ''}`,
            `Service: pixiv`,
            `ID: ${info.illustId || ''}`,
            `Published: ${info.createDate || ''}`,
            `Tags: ${tags}`,
            `URL: ${url}`,
            `Images: ${imageCount}/${totalImages}`,
            '',
            '---- Content ----',
            cleanText(info.caption),
        ].join('\n');
        zip.file('info.txt', infoTxt);
    };

    const artworkOriginalImage = () => {
        observerFactory({
            callback(mutations) {
                for (const mutation of mutations) {
                    for (const addedNode of mutation.addedNodes) {
                        let $img = $(addedNode).filter('img[src^="https://i.pximg.net/img-master"]');
                        if ($img.length === 0) {
                            $img = $(addedNode).find('img[src^="https://i.pximg.net/img-master"]');
                        }
                        if ($img.length === 0 || $img.attr('ahao-done')) continue;

                        $img.attr('ahao-done', true);
                        $img.each(function () {
                            const $this = $(this);
                            const href = $this.parent('a').attr('href');
                            const isExpand = $img.parent('a').attr('class') === 'gtm-expand-full-size-illust';
                            if (href?.endsWith('jpg') || href?.endsWith('png')) {
                                $this.attr('src', href).css('filter', 'none');
                                $this.fitWindow();
                                addImgSizeSpan({$: $this, position: isExpand ? 'relative' : 'absolute'});
                            }
                        });
                    }
                }
            },
            option: {attributes: true, childList: true, subtree: true, attributeFilter: ['src', 'href']}
        });
    };

    const artworkDownloadMultiImage = () => {
        observerFactory({
            callback: (mutations) => {
                for (const mutation of mutations) {
                    for (const addedNode of mutation.addedNodes) {
                        const $shareBtn = $(addedNode).find('div:has(> button[class^="style_transparentButton"]):eq(1)');
                        if($shareBtn.length <= 0 || $shareBtn.siblings('#ahao-download-zip').length > 0) continue;

                        const info = illustApi();
                        const num = info.pageCount;
                        const url = info.urls.original;
                        const imgUrls = Array(parseInt(num)).fill().map((_, index) => url.replace(/_p\d\./, `_p${index}.`));

                        const $zipBtn = addImageDownloadBtn({
                            $shareButtonContainer: $shareBtn,
                            id: 'ahao-download-zip',
                            text: `${i18n('download')}`,
                            clickFun() {
                                const btn = this;
                                if ($(btn).attr('start') === 'true') return;

                                $(btn).attr('start', 'true');
                                $zipBtn.find('p').html(`抓取中 0/${num}`);
                                const artworkUrl = location.href;

                                const zip = new JSZip();

                                (async () => {
                                    let successCount = 0;
                                    let failCount = 0;
                                    const baseName = getDownloadName();

                                    for (let index = 0; index < imgUrls.length; index++) {
                                        const u = imgUrls[index];
                                        try {
                                            const responseText = await new Promise((resolve, reject) => {
                                                GM.xmlHttpRequest({
                                                    method: 'GET', url: u,
                                                    headers: {referer: 'https://www.pixiv.net/'},
                                                    overrideMimeType: 'text/plain; charset=x-user-defined',
                                                    timeout: 15000,
                                                    onload: res => res.status === 200 ? resolve(res.responseText) : reject(`HTTP ${res.status}`),
                                                    onerror: err => reject(err),
                                                    ontimeout: () => reject('Timeout')
                                                });
                                            });

                                            const data = new Uint8Array(responseText.length);
                                            for (let i = 0; i < responseText.length; i++) data[i] = responseText.charCodeAt(i);
                                            const suffix = u.split('.').pop();
                                            const mimeType = {png: "image/png", jpg: "image/jpeg", gif: "image/gif"}[suffix];
                                            const blob = new Blob([data], {type: mimeType});

                                            zip.file(`${baseName}_${index}.${suffix}`, blob, {binary: true});
                                            successCount++;
                                        } catch (error) {
                                            console.error(`第 ${index} 张图下载失败:`, error);
                                            failCount++;
                                        }
                                        $zipBtn.find('p').html(`抓取中 ${successCount + failCount}/${num}`);
                                    }

                                    if (successCount === 0) {
                                        $zipBtn.find('p').html(`抓取失败`);
                                        $(btn).attr('start', 'false');
                                        return;
                                    }

                                    if (failCount > 0) alert(`有 ${failCount} 张图片获取失败，仅打包成功部分。`);

                                    addArtworkInfo(zip, info, successCount, num, artworkUrl);

                                    $zipBtn.find('p').html(`打包中 0%`);
                                    try {
                                        zip.generateAsync({ type: 'blob', compression: 'STORE' }, function updateCallback(metadata) {
                                            $zipBtn.find('p').html(`打包中 ${metadata.percent.toFixed(0)}%`);
                                        })
                                        .then(content => {
                                            saveAs(content, baseName + '.zip');
                                            $zipBtn.find('p').html(`完成!`);
                                            setTimeout(() => {
                                                $zipBtn.find('p').html(`${i18n('download')}`);
                                                $(btn).attr('start', 'false');
                                            }, 3000);
                                        });
                                    } catch (err) {
                                        console.error('ZIP 打包异常:', err);
                                        $zipBtn.find('p').html(`打包失败`);
                                        $(btn).attr('start', 'false');
                                    }
                                })();
                            }
                        });
                    }
                }
            },
            option: {attributes: true, childList: true, subtree: true, attributeFilter: ['src', 'href']}
        });
    };

    const getUgoiraFrames = async (info, updateProgress) => {
        updateProgress('获取元数据...');
        const metadata = await new Promise((resolve, reject) => {
            $.ajax({
                url: `/ajax/illust/${info.illustId}/ugoira_meta`, dataType: 'json',
                success: ({body, error, message}) => error ? reject(new Error(message || '元数据获取失败')) : resolve(body),
                error: () => reject(new Error('元数据获取失败'))
            });
        });
        if (!metadata?.originalSrc || !metadata.frames?.length) {
            throw new Error('动图元数据不完整');
        }

        updateProgress('下载图片集...');
        const data = await new Promise((resolve, reject) => {
            GM.xmlHttpRequest({
                method: 'GET', url: metadata.originalSrc,
                headers: {referer: 'https://www.pixiv.net/'},
                responseType: 'arraybuffer', timeout: 60000,
                onload: res => res.status === 200 ? resolve(res.response) : reject(new Error(`HTTP ${res.status}`)),
                onerror: () => reject(new Error('图片集下载失败')),
                ontimeout: () => reject(new Error('图片集下载超时'))
            });
        });
        const sourceZip = await JSZip.loadAsync(data);
        const frames = [];
        for (const frame of metadata.frames) {
            updateProgress(`读取帧 ${frames.length + 1}/${metadata.frames.length}`);
            const file = sourceZip.file(frame.file);
            if (!file) throw new Error(`图片集缺少帧: ${frame.file}`);
            const suffix = frame.file.split('.').pop().toLowerCase();
            const mimeType = {png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif'}[suffix];
            const blob = new Blob([await file.async('uint8array')], {type: mimeType || metadata.mime_type || 'application/octet-stream'});
            frames.push({...frame, suffix, blob});
        }
        return frames;
    };

    const renderUgoiraGif = async (frames, info, updateProgress) => {
        const frameUrls = [];
        let gifFactory;
        let renderTimeout;
        try {
            // @require 的 gif.js 已将 worker 打包成 Blob URL，必须显式使用它。
            if (typeof GIF_worker_URL !== 'string' || !GIF_worker_URL.startsWith('blob:')) {
                throw new Error('GIF 渲染组件未加载，请刷新页面后重试');
            }
            gifFactory = new GIF({
                workers: 2, quality: 10, workerScript: GIF_worker_URL,
                width: info.width, height: info.height
            });
            for (let index = 0; index < frames.length; index++) {
                updateProgress(`载入帧 ${index + 1}/${frames.length}`);
                const frame = frames[index];
                const img = document.createElement('img');
                img.width = info.width;
                img.height = info.height;
                const url = URL.createObjectURL(frame.blob);
                frameUrls.push(url);
                await new Promise((resolve, reject) => {
                    img.onload = resolve;
                    img.onerror = () => reject(new Error(`帧载入失败: ${frame.file}`));
                    img.src = url;
                });
                gifFactory.addFrame(img, {delay: frame.delay});
            }
            updateProgress('渲染中...');
            return await new Promise((resolve, reject) => {
                const resetTimeout = () => {
                    clearTimeout(renderTimeout);
                    renderTimeout = setTimeout(() => reject(new Error('GIF 渲染超时，请重试')), 120000);
                };
                gifFactory.on('start', () => {
                    const workers = new Set([...gifFactory.activeWorkers, ...gifFactory.freeWorkers]);
                    workers.forEach(worker => {
                        worker.addEventListener('error', () => reject(new Error('GIF 渲染失败，请重试')));
                        worker.addEventListener('messageerror', () => reject(new Error('GIF 渲染数据读取失败，请重试')));
                    });
                });
                gifFactory.on('progress', pct => {
                    resetTimeout();
                    updateProgress(`渲染 ${Math.floor(pct * 100)}%`);
                });
                gifFactory.on('finished', resolve);
                gifFactory.on('abort', () => reject(new Error('GIF 渲染已中止')));
                gifFactory.on('error', reject);
                resetTimeout();
                gifFactory.render();
            });
        } finally {
            clearTimeout(renderTimeout);
            if (gifFactory) {
                const workers = new Set([...gifFactory.activeWorkers, ...gifFactory.freeWorkers]);
                workers.forEach(worker => worker.terminate());
            }
            frameUrls.forEach(url => URL.revokeObjectURL(url));
        }
    };

    const artworkDownloadGifImage = () => {
        observerFactory({
            callback: (mutations) => {
                for (const mutation of mutations) {
                    for (const addedNode of mutation.addedNodes) {
                        const $canvas = $(addedNode).find('canvas');
                        if ($canvas.length > 0) addImgSizeSpan({$: $canvas});

                        const $shareBtn = $(addedNode).find('div:has(> button[class^="style_transparentButton"]):eq(1)');
                        if($shareBtn.length <= 0 || $shareBtn.siblings('#ahao-download-gif').length > 0) continue;

                        const addUgoiraDownloadBtn = (mode, id, text) => {
                            const $downloadBtn = addImageDownloadBtn({
                                $shareButtonContainer: $shareBtn, id, text,
                                async clickFun() {
                                    const btn = this;
                                    if ($(btn).attr('start') === 'true') return;
                                    $(btn).attr('start', 'true');
                                    const updateProgress = message => $downloadBtn.find('p').text(message);
                                    try {
                                        const info = illustApi();
                                        const artworkUrl = location.href;
                                        const baseName = getDownloadName(info);
                                        const frames = await getUgoiraFrames(info, updateProgress);
                                        const zip = new JSZip();
                                        if (mode === 'gif') {
                                            const gifBlob = await renderUgoiraGif(frames, info, updateProgress);
                                            zip.file(`${baseName}.gif`, gifBlob, {binary: true});
                                            addArtworkInfo(zip, info, 1, 1, artworkUrl);
                                        } else {
                                            frames.forEach((frame, index) => {
                                                zip.file(`${baseName}_${index}.${frame.suffix}`, frame.blob, {binary: true});
                                            });
                                            addArtworkInfo(zip, info, frames.length, frames.length, artworkUrl);
                                        }
                                        updateProgress('打包中 0%');
                                        const content = await zip.generateAsync({type: 'blob', compression: 'STORE'}, metadata => {
                                            updateProgress(`打包中 ${metadata.percent.toFixed(0)}%`);
                                        });
                                        saveAs(content, baseName + '.zip');
                                        updateProgress('完成!');
                                        setTimeout(() => {
                                            updateProgress(text);
                                            $(btn).attr('start', 'false');
                                        }, 3000);
                                    } catch (error) {
                                        console.error('动图下载失败:', error);
                                        updateProgress('下载失败，点击重试');
                                        $(btn).attr('start', 'false');
                                    }
                                }
                            });
                        };

                        addUgoiraDownloadBtn('frames', 'ahao-download-zip', '下载图片集压缩包');
                        addUgoiraDownloadBtn('gif', 'ahao-download-gif', '下载 GIF 压缩包');
                    }
                }
            },
            option: {attributes: true, childList: true, subtree: true, attributeFilter: ['src', 'href']}
        });
    };

    if (isArtworkPage()) {
        artworkOriginalImage();
        if (!isGifMode()) {
            artworkDownloadMultiImage();
        }
        if (isGifMode()) {
            artworkDownloadGifImage();
        }
    }
});
