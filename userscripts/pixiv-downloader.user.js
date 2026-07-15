// ==UserScript==
// @name        Pixiv 图片下载提取版 (极速打包+自定义命名)
// @namespace   https://github.com/takuron/raw
// @version     1.0.5
// @description 提取了 Pixiv Plus 脚本的图片下载功能，支持自定义命名格式与空格替换，使用 STORE 模式极速打包 ZIP。
// @author      Ahaochan Takuron
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

    const getDownloadName = () => {
        const info = illustApi();
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

    const artworkDownloadGifImage = () => {
        observerFactory({
            callback: (mutations) => {
                for (const mutation of mutations) {
                    for (const addedNode of mutation.addedNodes) {
                        const $canvas = $(addedNode).find('canvas');
                        if ($canvas.length > 0) addImgSizeSpan({$: $canvas});

                        const $shareBtn = $(addedNode).find('div:has(> button[class^="style_transparentButton"]):eq(1)');
                        if($shareBtn.length <= 0 || $shareBtn.siblings('#ahao-download-gif').length > 0) continue;

                        const $zipBtn = addImageDownloadBtn({
                            $shareButtonContainer: $shareBtn,
                            id: 'ahao-download-zip',
                            text: 'zip',
                        });

                        const $gifBtn = addImageDownloadBtn({
                            $shareButtonContainer: $shareBtn,
                            id: 'ahao-download-gif',
                            text: 'gif',
                            clickFun() {
                                const btn = this;
                                if ($(btn).attr('start') === 'true') return;
                                $(btn).attr('start', 'true');
                                $gifBtn.find('p').text(`获取元数据...`);

                                $.ajax({
                                    url: `/ajax/illust/${illustApi().illustId}/ugoira_meta`, dataType: 'json',
                                    success: async ({body}) => {
                                        let gifUrl;
                                        const gifFrames = [];
                                        const gifFactory = new GIF({workers: 2, quality: 10});

                                        const frames = body.frames;

                                        for (let frameIdx = 0; frameIdx < frames.length; frameIdx++) {
                                            $gifBtn.find('p').text(`抓取帧 ${frameIdx + 1}/${frames.length}`);
                                            const frame = frames[frameIdx];
                                            const u = illustApi().urls.original.replace('ugoira0.', `ugoira${frameIdx}.`);

                                            try {
                                                const responseText = await new Promise((resolve, reject) => {
                                                    GM.xmlHttpRequest({
                                                        method: 'GET', url: u,
                                                        headers: {referer: 'https://www.pixiv.net/'},
                                                        overrideMimeType: 'text/plain; charset=x-user-defined',
                                                        timeout: 10000,
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

                                                const img = document.createElement('img');
                                                img.src = URL.createObjectURL(blob);
                                                img.width = illustApi().width;
                                                img.height = illustApi().height;

                                                await new Promise((resolveImg) => {
                                                    img.onload = () => {
                                                        gifFrames.push({frame: img, option: {delay: frame.delay}});
                                                        resolveImg();
                                                    };
                                                });
                                            } catch (error) {
                                                console.error(`GIF 帧 ${frameIdx} 下载失败:`, error);
                                            }
                                        }

                                        if (gifFrames.length === 0) {
                                            $gifBtn.find('p').text(`获取失败`);
                                            $(btn).attr('start', 'false');
                                            return;
                                        }

                                        $gifBtn.find('p').text(`渲染中...`);
                                        $.each(gifFrames, (i, f) => gifFactory.addFrame(f.frame, f.option));

                                        gifFactory.on('progress', pct => {
                                            $gifBtn.find('p').text(`渲染 ${parseInt(pct * 100)}%`);
                                        });

                                        gifFactory.on('finished', blob => {
                                            gifUrl = URL.createObjectURL(blob);
                                            const baseName = getDownloadName();
                                            const $a = $(`<a href="${gifUrl}" download="${baseName}.gif"></a>`);
                                            $gifBtn.find('button').wrap($a);
                                            $gifBtn.find('p').text(`完成!`);
                                        });

                                        gifFactory.render();
                                    },
                                    error: () => {
                                        $gifBtn.find('p').text(`元数据失败`);
                                        $(btn).attr('start', 'false');
                                    }
                                });
                            }
                        });

                        $.ajax({
                            url: `/ajax/illust/${illustApi().illustId}/ugoira_meta`, dataType: 'json',
                            success: ({body}) => {
                                const baseName = getDownloadName();
                                const $a = $(`<a href="${body.originalSrc}" download="${baseName}.zip"></a>`);
                                $zipBtn.find('button').wrap($a);
                            }
                        });
                    }
                }
            },
            option: {attributes: true, childList: true, subtree: true, attributeFilter: ['src', 'href']}
        });
    };

    if (isArtworkPage()) {
        artworkOriginalImage();
        if (isMoreMode()) {
            artworkDownloadMultiImage();
        }
        if (isGifMode()) {
            artworkDownloadGifImage();
        }
    }
});
