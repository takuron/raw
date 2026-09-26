// ==UserScript==
// @name               Twitter/X Media Downloader Plus (ZIP 打包 + 分享图)
// @name:en            Twitter/X Media Downloader Plus (ZIP + Share Image)
// @namespace          https://github.com/takuron/raw
// @version            1.1.0
// @description        一键将当前推文的所有媒体与正文打包为 ZIP；并在下载按钮旁提供生成白底圆角分享图功能
// @description:en     One-click pack all media + tweet text into a ZIP; generate a white rounded-border share image next to the download button
// @author             Takuron / goemon2017 / 天音 / Tiande / ChinaGodMan (TMD) + limbopro (share image)
// @license            MIT
// @tag                download
// @tag                twitter
// @tag                zip
// @tag                share-image
// @updateURL          https://raw.takuron.com/userscripts/twitter-downloader.meta.js
// @downloadURL        https://raw.takuron.com/userscripts/twitter-downloader.user.js
// @match              https://x.com/*
// @match              https://twitter.com/*
// @require            https://cdnjs.cloudflare.com/ajax/libs/jszip/3.7.1/jszip.min.js
// @grant              GM_registerMenuCommand
// @grant              GM_setValue
// @grant              GM_getValue
// @grant              GM_download
// @run-at             document-idle
// ==/UserScript==

/**
 * 由以下两个脚本合并：
 *  1. Twitter/X Media Downloader（ChinaGodMan / goemon2017 等）—— 下载、ZIP 打包、设置、历史记录
 *  2. Twitter/X(网页版)视频/原始图片/gif一键下载 [limbopro] —— “推文生成图片”功能
 *
 * 本脚本相对原版的改动：
 *  - 在每条推文的下载按钮右侧新增“生成分享图”按钮。
 *  - 下载逻辑改为：无论媒体数量多少，始终将当前推文的全部媒体 + 推文正文打包为一个 ZIP。
 *  - 文件名格式设置现在用于命名 ZIP 归档（占位符 {user-name}/{user-id}/{date-time}/{status-id}/{full-text}/{file-type}）。
 *  - 分享图改为白底 + 外描边圆角矩形；作者头像绘制在作者信息与推文链接的前方。
 */

/* jshint esversion: 8 */

const default_filename = '[x.com][{status-id}]{user-name}(@{user-id})_{date-time}'
const invalid_chars = {
    '\\': '＼', '/': '／', '|': '｜', '<': '＜', '>': '＞', ':': '：',
    '*': '＊', '?': '？', '"': '＂',
    '\u200b': '', '\u200c': '', '\u200d': '', '\u2060': '', '\ufeff': '', '🔞': ''
}

function sanitizeFileName(name) {
    return String(name).replace(/[\\/:*?"<>|\r\n]/g, v => (invalid_chars[v] === undefined ? v : invalid_chars[v]))
}

// 给 twimg 图片 URL 设置 name 参数（large / orig），兼容已有 query 的情况
function setImageName(url, name) {
    try {
        const u = new URL(url, location.origin)
        u.searchParams.set('name', name)
        return u.href
    } catch (e) {
        return url + (url.indexOf('?') >= 0 ? '&' : '?') + 'name=' + name
    }
}

// 圆角矩形路径（兼容不支持 ctx.roundRect 的浏览器）
function roundRectPath(ctx, x, y, w, h, r) {
    r = Math.max(0, Math.min(r, w / 2, h / 2))
    ctx.beginPath()
    ctx.moveTo(x + r, y)
    ctx.lineTo(x + w - r, y)
    ctx.arcTo(x + w, y, x + w, y + r, r)
    ctx.lineTo(x + w, y + h - r)
    ctx.arcTo(x + w, y + h, x + w - r, y + h, r)
    ctx.lineTo(x + r, y + h)
    ctx.arcTo(x, y + h, x, y + h - r, r)
    ctx.lineTo(x, y + r)
    ctx.arcTo(x, y, x + r, y, r)
    ctx.closePath()
}

const TMD = (function () {
    let lang, host, history, show_sensitive, is_tweetdeck
    return {
        init: async function () {
            GM_registerMenuCommand((this.language[navigator.language] || this.language.en).settings, this.settings)
            GM_registerMenuCommand('Export History (Markdown)', async () => this.exportHistory())
            lang = this.language[document.querySelector('html').lang] || this.language.en
            host = location.hostname
            is_tweetdeck = host.indexOf('tweetdeck') >= 0
            history = this.storage_obsolete()
            if (history.length) {
                this.storage(history)
                this.storage_obsolete(true)
            } else history = await this.storage()
            show_sensitive = GM_getValue('show_sensitive', false)
            document.head.insertAdjacentHTML('beforeend', '<style>' + this.css + (show_sensitive ? this.css_ss : '') + '</style>')
            let observer = new MutationObserver(ms => ms.forEach(m => m.addedNodes.forEach(node => this.detect(node))))
            observer.observe(document.body, { childList: true, subtree: true })
        },
        exportHistory: async function () {
            try {
                const history = await GM_getValue('download_history', [])
                if (!history || !Array.isArray(history) || history.length === 0) {
                    return
                }
                const markdownContent = '# Twitter/X Media Downloader history\n\n' +
                    (await Promise.all(history.map(id => this.generateMarkdown(id)))).join('\n')
                const blob = new Blob([markdownContent], { type: 'text/markdown;charset=utf-8' })
                const link = document.createElement('a')
                link.href = URL.createObjectURL(blob)
                link.download = `twitter_download_history_(${history.length}).md`
                document.body.appendChild(link)
                link.click()
                document.body.removeChild(link)
                URL.revokeObjectURL(link.href)
            } catch (error) {
                console.error('An error occurred while exporting Markdown history:', error)
                alert('An error occurred while exporting Markdown history, please check the console for details.')
            }
        },
        generateMarkdown: async function (tweet_id, fetch = true) {
            if (!fetch) return `[Tweet] - ${tweet_id} (https://x.com/i/web/status/${tweet_id})`
            let json = await this.fetchJson(tweet_id)
            let tweet = json.quoted_status_result?.result?.legacy?.media
                || json.quoted_status_result?.result?.legacy
                || json.legacy
            let user = json.core.user_results.result.legacy
            let user_name = user.name.replace(/([\\/|*?:"\u200b-\u200d\u2060\ufeff]|🔞)/g, v => invalid_chars[v] || '')
            let full_text = (tweet.full_text || '').split('\n').join(' ').replace(/\s*https:\/\/t\.co\/\w+/g, '').replace(/[\\/|<>*?:"\u200b-\u200d\u2060\ufeff]/g, v => invalid_chars[v] || '')
            return `[${user_name} (@${user.screen_name})](https://x.com/i/web/status/${tweet_id})\n>  ${full_text}\n`
        },
        detect: function (node) {
            let article = node.tagName == 'ARTICLE' && node || node.tagName == 'DIV' && (node.querySelector('article') || node.closest('article'))
            if (article) this.addButtonTo(article)
            let listitems = node.tagName == 'LI' && node.getAttribute('role') == 'listitem' && [node] || node.tagName == 'DIV' && node.querySelectorAll('li[role="listitem"]')
            if (listitems) this.addButtonToMedia(listitems)
        },
        addButtonTo: function (article) {
            if (article.dataset.detected) return
            article.dataset.detected = 'true'
            let media_selector = [
                'a[href*="/photo/1"]',
                'div[role="progressbar"]',
                'button[data-testid="playButton"]',
                'a[href="/settings/content_you_see"]', //hidden content
                'div.media-image-container', // for tweetdeck
                'div.media-preview-container', // for tweetdeck
                'div[aria-labelledby]>div:first-child>div[role="button"][tabindex="0"]' //for audio (experimental)
            ]
            let media = article.querySelector(media_selector.join(','))
            let current_tweet_id = document.location.href.includes('/status/')
                ? document.location.href.split('/status/').pop().split('/').shift()
                : undefined
            if (media) {
                let status_id = current_tweet_id || article.querySelector('a[href*="/status/"]').href.split('/status/').pop().split('/').shift()
                let btn_group = article.querySelector('div[role="group"]:last-of-type, ul.tweet-actions, ul.tweet-detail-actions')
                let btn_share = Array.from(btn_group.querySelectorAll(':scope>div>div, li.tweet-action-item>a, li.tweet-detail-action-item>a')).pop().parentNode
                let btn_down = btn_share.cloneNode(true)
                btn_down.querySelector('button').removeAttribute('disabled')
                if (is_tweetdeck) {
                    btn_down.firstElementChild.innerHTML = '<svg viewBox="0 0 24 24" style="width: 18px; height: 18px;">' + this.svg + '</svg>'
                    btn_down.firstElementChild.removeAttribute('rel')
                    btn_down.classList.replace('pull-left', 'pull-right')
                } else {
                    btn_down.querySelector('svg').innerHTML = this.svg
                }
                let is_exist = history.indexOf(status_id) >= 0
                this.status(btn_down, 'tmd-down')
                this.status(btn_down, is_exist ? 'completed' : 'download', is_exist ? lang.completed : lang.download)
                btn_group.insertBefore(btn_down, btn_share.nextSibling)
                btn_down.onclick = () => this.click(btn_down, status_id, is_exist)

                // ===== 新增：分享图按钮，紧邻下载按钮 =====
                let btn_img = btn_share.cloneNode(true)
                btn_img.querySelector('button').removeAttribute('disabled')
                if (is_tweetdeck) {
                    btn_img.firstElementChild.innerHTML = '<svg viewBox="0 0 24 24" style="width: 18px; height: 18px;">' + this.svg_share + '</svg>'
                    btn_img.firstElementChild.removeAttribute('rel')
                    btn_img.classList.replace('pull-left', 'pull-right')
                } else {
                    btn_img.querySelector('svg').innerHTML = this.svg_share
                }
                this.status(btn_img, 'tmd-down share', lang.share)
                btn_group.insertBefore(btn_img, btn_down.nextSibling)
                btn_img.onclick = () => this.share(btn_img, status_id)

                if (show_sensitive) {
                    let btn_show = article.querySelector('div[aria-labelledby] div[role="button"][tabindex="0"]:not([data-testid]) > div[dir] > span > span')
                    if (btn_show) btn_show.click()
                }
            }
        },
        addButtonToMedia: function (listitems) {
            listitems.forEach(li => {
                if (li.dataset.detected) return
                li.dataset.detected = 'true'
                let link = li.querySelector('a[href*="/status/"]')
                if (!link) return
                let status_id = link.href.split('/status/').pop().split('/').shift()
                let is_exist = history.indexOf(status_id) >= 0
                let wrap = document.createElement('div')
                wrap.className = 'tmd-media-btns'

                let btn_down = document.createElement('div')
                btn_down.innerHTML = '<div><div><svg viewBox="0 0 24 24" style="width: 18px; height: 18px;">' + this.svg + '</svg></div></div>'
                btn_down.classList.add('tmd-down', 'tmd-media')
                this.status(btn_down, is_exist ? 'completed' : 'download', is_exist ? lang.completed : lang.download)
                btn_down.onclick = () => this.click(btn_down, status_id, is_exist)

                let btn_img = document.createElement('div')
                btn_img.innerHTML = '<div><div><svg viewBox="0 0 24 24" style="width: 18px; height: 18px;">' + this.svg_share + '</svg></div></div>'
                btn_img.classList.add('tmd-down', 'tmd-media', 'share')
                this.status(btn_img, 'share', lang.share)
                btn_img.onclick = () => this.share(btn_img, status_id)

                wrap.appendChild(btn_down)
                wrap.appendChild(btn_img)
                li.appendChild(wrap)
            })
        },
        selectTweetDialog: function (originalUser, quotedUser) {
            return new Promise((resolve) => {
                const overlay = document.createElement('div')
                overlay.style.cssText = `
                    position: fixed;
                    left: 0;
                    top: 0;
                    width: 100%;
                    height: 100%;
                    background-color: rgba(0, 0, 0, 0.7);
                    z-index: 10000;
                    display: flex;
                    justify-content: center;
                    align-items: center;
                `
                const dialog = document.createElement('div')
                dialog.style.cssText = `
                    background: white;
                    border-radius: 16px;
                    padding: 24px;
                    width: 400px;
                    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
                    font-family: system-ui, -apple-system, sans-serif;
                `
                const title = document.createElement('h3')
                title.textContent = `${lang.choose}`
                title.style.cssText = `
                    margin-top: 0;
                    margin-bottom: 20px;
                    text-align: center;
                    color: #0f1419;
                `
                const buttonsContainer = document.createElement('div')
                buttonsContainer.style.cssText = `
                    display: flex;
                    flex-direction: column;
                    gap: 12px;
                `
                const originalBtn = document.createElement('button')
                originalBtn.textContent = `${lang.original} (by ${originalUser})`
                originalBtn.style.cssText = `
                    background: #1DA1F2;
                    color: white;
                    border: none;
                    border-radius: 50px;
                    padding: 16px;
                    font-size: 16px;
                    font-weight: 600;
                    cursor: pointer;
                    transition: background 0.2s;
                `
                originalBtn.addEventListener('mouseenter', () => { originalBtn.style.background = '#1a91da' })
                originalBtn.addEventListener('mouseleave', () => { originalBtn.style.background = '#1DA1F2' })
                originalBtn.addEventListener('click', () => {
                    resolve('original')
                    document.body.removeChild(overlay)
                })
                const quotedBtn = document.createElement('button')
                quotedBtn.textContent = `${lang.quote} (by ${quotedUser})`
                quotedBtn.style.cssText = `
                    background: #fff;
                    color: #1DA1F2;
                    border: 2px solid #1DA1F2;
                    border-radius: 50px;
                    padding: 16px;
                    font-size: 16px;
                    font-weight: 600;
                    cursor: pointer;
                    transition: all 0.2s;
                `
                quotedBtn.addEventListener('mouseenter', () => { quotedBtn.style.background = '#f0f8ff' })
                quotedBtn.addEventListener('mouseleave', () => { quotedBtn.style.background = '#fff' })
                quotedBtn.addEventListener('click', () => {
                    resolve('quoted')
                    document.body.removeChild(overlay)
                })
                const cancelBtn = document.createElement('button')
                cancelBtn.textContent = `${lang.cancel}`
                cancelBtn.style.cssText = `
                    background: transparent;
                    color: #657786;
                    border: none;
                    padding: 12px;
                    font-size: 14px;
                    cursor: pointer;
                    margin-top: 8px;
                `
                cancelBtn.addEventListener('click', () => {
                    resolve(null)
                    document.body.removeChild(overlay)
                })
                buttonsContainer.appendChild(originalBtn)
                buttonsContainer.appendChild(quotedBtn)
                buttonsContainer.appendChild(cancelBtn)
                dialog.appendChild(title)
                dialog.appendChild(buttonsContainer)
                overlay.appendChild(dialog)
                document.body.appendChild(overlay)
                overlay.addEventListener('click', (e) => {
                    if (e.target === overlay) {
                        resolve(null)
                        document.body.removeChild(overlay)
                    }
                })
            })
        },
        // 展开文件名模板
        expandName: function (out, info) {
            let name = out.replace(/[._-]?\{file-ext\}/g, '')
            name = name.replace(/\{([^{}:]+)(:[^{}]+)?\}/g, (match, key) => (info[key] !== undefined ? info[key] : ''))
            return sanitizeFileName(name).trim() || 'twitter_media'
        },
        // 构造文件名模板占位符信息（ZIP 与分享图共用同一套命名逻辑）
        buildInfo: function (out, tweet, user, status_id) {
            let info = {}
            info['status-id'] = status_id
            info['user-name'] = sanitizeFileName(user.name.replace(/([\\/|*?:"\u200b-\u200d\u2060\ufeff]|🔞)/g, v => invalid_chars[v] || ''))
            info['user-id'] = user.screen_name
            const dtMatch = out.match(/\{date-time(?:-local)?:([^{}]+)\}/)
            const datetime = dtMatch ? dtMatch[1].replace(/[\\/|<>*?:"]/g, v => invalid_chars[v] || '') : 'YYYYMMDD-hhmmss'
            info['date-time'] = this.formatDate(tweet.created_at, datetime)
            info['date-time-local'] = this.formatDate(tweet.created_at, datetime, true)
            info['date'] = this.formatDate(tweet.created_at, 'YYYY-MM-DD hh:mm:ss') + ' UTC'
            info['full-text'] = (tweet.full_text || '').split('\n').join(' ').replace(/\s*https:\/\/t\.co\/\w+/g, '').replace(/[\\/|<>*?:"\u200b-\u200d\u2060\ufeff]/g, v => invalid_chars[v] || '')
            return info
        },
        // 保存 Blob（Firefox 用 GM_download，其它用 a.click）
        saveBlob: function (blob, name) {
            return new Promise((resolve) => {
                const url = URL.createObjectURL(blob)
                const isFirefox = navigator.userAgent.toLowerCase().indexOf('firefox') > -1
                if (isFirefox && typeof GM_download === 'function') {
                    GM_download({
                        url: url,
                        name: name,
                        onload: () => { URL.revokeObjectURL(url); resolve() },
                        onerror: () => { URL.revokeObjectURL(url); resolve() }
                    })
                } else {
                    const a = document.createElement('a')
                    a.href = url
                    a.download = name
                    document.body.appendChild(a)
                    a.click()
                    setTimeout(() => {
                        document.body.removeChild(a)
                        URL.revokeObjectURL(url)
                        resolve()
                    }, 100)
                }
            })
        },
        // 始终：全部媒体 + 正文 -> 一个 ZIP
        packageZip: async function (medias, out, info, save_history, is_exist, status_id, btn) {
            const zip = new JSZip()
            let success = 0, failed = 0
            for (let i = 0; i < medias.length; i++) {
                const media = medias[i]
                let url
                if (media.type === 'photo') {
                    url = setImageName(media.media_url_https, 'orig')
                } else {
                    const variants = ((media.video_info && media.video_info.variants) || []).filter(v => v.content_type == 'video/mp4')
                    if (!variants.length) { failed++; continue }
                    variants.sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0))
                    url = variants[0].url
                }
                let base = 'media', ext = media.type === 'photo' ? 'jpg' : 'mp4'
                try {
                    const file = new URL(url, location.origin).pathname.split('/').pop()
                    if (file.indexOf('.') >= 0) {
                        ext = file.split('.').pop()
                        base = file.split('.').slice(0, -1).join('.')
                    } else {
                        base = file
                    }
                } catch (e) { }
                const entry = String(i + 1).padStart(3, '0') + '_' + base + '.' + ext
                this.status(btn, 'loading', (lang.packaging || 'Packaging') + ' ' + (i + 1) + '/' + medias.length)
                try {
                    const res = await fetch(url)
                    if (!res.ok) throw new Error('HTTP ' + res.status)
                    const buf = await res.arrayBuffer()
                    zip.file(entry, new Uint8Array(buf))
                    success++
                } catch (e) {
                    failed++
                    console.warn('[TMD+] media failed:', url, e)
                }
            }
            const text = [
                'Service: x.com',
                'ID: ' + info['status-id'],
                'Date: ' + info['date'],
                'Author: ' + info['user-name'] + ' (@' + info['user-id'] + ')',
                'URL: https://x.com/' + info['user-id'] + '/status/' + info['status-id'],
                'Media: ' + success + '/' + medias.length,
                '',
                '---- Content ----',
                info['full-text'] || '(No text content)',
                ''
            ].join('\n')
            zip.file('info.txt', text)

            this.status(btn, 'loading', (lang.packaging || 'Packaging') + ' 0%')
            const blob = await zip.generateAsync({ type: 'blob', compression: 'STORE' }, (m) => {
                this.status(btn, 'loading', (lang.packaging || 'Packaging') + ' ' + m.percent.toFixed(0) + '%')
            })
            const zipName = this.expandName(out, info) + '.zip'
            await this.saveBlob(blob, zipName)
            this.status(btn, 'completed', failed ? (lang.completed + ' (' + failed + ' failed)') : lang.completed)
            if (save_history && !is_exist) {
                history.push(status_id)
                this.storage(status_id)
            }
        },
        click: async function (btn, status_id, is_exist) {
            if (btn.classList.contains('loading')) return
            this.status(btn, 'loading', lang.packaging || 'Packaging')
            try {
                let out = (await GM_getValue('filename', default_filename)).split('\n').join('')
                let save_history = await GM_getValue('save_history', true)
                let json = await this.fetchJson(status_id)

                let hasQuotedMedia = json.quoted_status_result?.result?.legacy?.media ||
                    json.quoted_status_result?.result?.legacy?.extended_entities?.media

                let tweet
                let user
                if (hasQuotedMedia) {
                    let originalUser = `${json.core?.user_results?.result?.legacy?.name} @${json.core?.user_results?.result?.legacy?.screen_name}`
                    let quotedUser = `${json.quoted_status_result?.result?.core?.user_results?.result?.legacy?.name} @${json.quoted_status_result?.result?.core?.user_results?.result?.legacy?.screen_name}`
                    let choice = await this.selectTweetDialog(originalUser, quotedUser)
                    if (!choice) {
                        this.status(btn, 'download', lang.download)
                        return
                    }
                    if (choice === 'quoted') {
                        tweet = json.quoted_status_result.result.legacy
                        user = json.quoted_status_result.result.core.user_results.result.legacy
                    } else {
                        tweet = json.legacy
                        user = json.core.user_results.result.legacy
                    }
                } else {
                    tweet = json.legacy
                    user = json.core.user_results.result.legacy
                }

                if (json && json.card) {
                    this.status(btn, 'failed', 'This tweet contains a link, which is not supported by this script.')
                    return
                }
                let medias = (tweet.extended_entities && tweet.extended_entities.media) || tweet.media || []
                if (!Array.isArray(medias)) medias = []

                let info = this.buildInfo(out, tweet, user, status_id)

                await this.packageZip(medias, out, info, save_history, is_exist, status_id, btn)
            } catch (e) {
                console.error('[TMD+] download error', e)
                this.status(btn, 'failed', e.message || String(e))
            }
        },
        // ===== 分享图 =====
        share: async function (btn, status_id) {
            if (btn.classList.contains('loading')) return
            this.status(btn, 'loading', lang.share_loading || 'Rendering…')
            try {
                let out = (await GM_getValue('filename', default_filename)).split('\n').join('')
                const json = await this.fetchJson(status_id)
                const tweet = json.legacy ||
                    (json.quoted_status_result && json.quoted_status_result.result && json.quoted_status_result.result.legacy)
                const user = (json.core && json.core.user_results && json.core.user_results.result && json.core.user_results.result.legacy) ||
                    (json.quoted_status_result && json.quoted_status_result.result && json.quoted_status_result.result.core &&
                        json.quoted_status_result.result.core.user_results.result.legacy)
                if (!tweet || !user) throw new Error('Cannot read tweet')
                const dataUrl = await this.renderShareImage(tweet, user, status_id)
                this.status(btn, 'share', lang.share)
                // 分享图文件名与 ZIP 使用同一套命名模板（仅扩展名不同）
                const info = this.buildInfo(out, tweet, user, status_id)
                const fileName = this.expandName(out, info) + '.jpg'
                this.showShareOverlay(dataUrl, fileName)
            } catch (e) {
                console.error('[TMD+] share error', e)
                this.status(btn, 'failed', e.message || String(e))
            }
        },
        renderShareImage: async function (tweet, user, status_id) {
            const W = 1170
            const INSET = 22
            const PAD = 60
            const FONT = 'Arial, "PingFang SC", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif'
            const INK = '#0f1419'
            const MUTED = '#536471'
            const LINK = '#1d9bf0'
            const BORDER = '#d0d7de'
            const DIVIDER = '#e1e8ed'

            const contentW = W - PAD * 2
            const textFont = 42
            const nameFont = 46
            const subFont = 33
            const smallFont = 28
            const lineH = Math.round(textFont * 1.4)
            const gap = 16
            const blockGap = 36

            const fullText = String(tweet.full_text || '')
                .replace(/\s*https:\/\/t\.co\/\w+/g, '')
                .replace(/\n{3,}/g, '\n\n')
                .trim()
            const rawMedia = (tweet.extended_entities && tweet.extended_entities.media) || tweet.media || []
            const mediaList = Array.isArray(rawMedia) ? rawMedia.slice(0, 4) : []
            const avatarUrl = user.profile_image_url_https
                ? user.profile_image_url_https.replace(/_normal(\.[a-zA-Z]+)$/, '_400x400$1')
                : ''
            const authorName = user.name || ''
            const handle = '@' + (user.screen_name || '')
            const tweetUrl = 'https://x.com/' + (user.screen_name || 'i') + '/status/' + status_id
            const dateStr = this.formatDate(tweet.created_at, 'YYYY-MM-DD hh:mm') + ' UTC'
            const statsLine = 'Images ' + mediaList.length + '  ·  Likes ' + (tweet.favorite_count || 0) + '  ·  Retweets ' + (tweet.retweet_count || 0)

            const canvas = document.createElement('canvas')
            const ctx = canvas.getContext('2d')

            function wrap(text, maxWidth, font) {
                ctx.font = font + 'px ' + FONT
                const lines = []
                String(text).split('\n').forEach(function (para) {
                    if (para === '') { lines.push(''); return }
                    let cur = ''
                    Array.from(para).forEach(function (ch) {
                        const test = cur + ch
                        if (cur !== '' && ctx.measureText(test).width > maxWidth) {
                            lines.push(cur)
                            cur = ch
                        } else {
                            cur = test
                        }
                    })
                    if (cur !== '') lines.push(cur)
                })
                return lines
            }

            const textLines = wrap(fullText || '(No text content)', contentW, textFont)

            // 预加载媒体图片
            const loaded = []
            for (let i = 0; i < mediaList.length; i++) {
                const src = setImageName(mediaList[i].media_url_https, 'large')
                const img = await new Promise(function (resolve) {
                    const im = new Image()
                    im.crossOrigin = 'anonymous'
                    im.onload = function () { resolve(im) }
                    im.onerror = function () { resolve(null) }
                    im.src = src
                })
                if (img) loaded.push(img)
            }
            // 预加载头像
            const avatarImg = await new Promise(function (resolve) {
                if (!avatarUrl) return resolve(null)
                const im = new Image()
                im.crossOrigin = 'anonymous'
                im.onload = function () { resolve(im) }
                im.onerror = function () { resolve(null) }
                im.src = avatarUrl
            })

            // 按原始比例排版：横向一张一行（整宽），竖向一张占半宽、两张一行；完整展示（contain，不裁剪）
            const rows = []
            {
                let i = 0
                while (i < loaded.length) {
                    const im = loaded[i]
                    if (im.width >= im.height) {
                        rows.push({ imgs: [im], x0: PAD, cellW: contentW, h: contentW * (im.height / im.width) })
                        i++
                    } else {
                        const group = [im]
                        if (i + 1 < loaded.length && loaded[i + 1].width < loaded[i + 1].height) {
                            group.push(loaded[i + 1])
                            i++
                        }
                        const cellW = (contentW - gap) / 2
                        const h = Math.max.apply(null, group.map(g => cellW * (g.height / g.width)))
                        const x0 = group.length === 2 ? PAD : PAD + (contentW - cellW) / 2
                        rows.push({ imgs: group, x0: x0, cellW: cellW, h: h })
                        i++
                    }
                }
            }
            const imgH = rows.length ? rows.reduce((s, r) => s + r.h, 0) + gap * (rows.length - 1) : 0

            const avatarSize = 92
            const footerTextH = nameFont + 12 + subFont + 12 + smallFont
            const footerH = Math.max(avatarSize, footerTextH)

            const imgBlock = imgH > 0 ? imgH + blockGap : 0
            const totalH = Math.ceil(PAD + textLines.length * lineH + blockGap + imgBlock + 80 + footerH + PAD)

            canvas.width = W
            canvas.height = totalH

            // 白底
            ctx.fillStyle = '#ffffff'
            ctx.fillRect(0, 0, W, totalH)

            // 外描边圆角矩形
            roundRectPath(ctx, INSET, INSET, W - INSET * 2, totalH - INSET * 2, 36)
            ctx.strokeStyle = BORDER
            ctx.lineWidth = 4
            ctx.stroke()

            // 正文
            ctx.textBaseline = 'alphabetic'
            ctx.fillStyle = INK
            ctx.font = textFont + 'px ' + FONT
            let y = PAD
            for (let i = 0; i < textLines.length; i++) {
                if (textLines[i] !== '') ctx.fillText(textLines[i], PAD, y + textFont)
                y += lineH
            }

            // 媒体
            y += blockGap
            const drawContain = (img, x, yy, w, h) => {
                const ratio = Math.min(w / img.width, h / img.height)
                const dw = img.width * ratio
                const dh = img.height * ratio
                const dx = x + (w - dw) / 2
                const dy = yy + (h - dh) / 2
                ctx.save()
                roundRectPath(ctx, x, yy, w, h, 16)
                ctx.clip()
                ctx.drawImage(img, dx, dy, dw, dh)
                ctx.restore()
            }
            for (let r = 0; r < rows.length; r++) {
                const row = rows[r]
                for (let j = 0; j < row.imgs.length; j++) {
                    const x = row.x0 + j * (row.cellW + gap)
                    drawContain(row.imgs[j], x, y, row.cellW, row.h)
                }
                y += row.h + gap
            }
            if (imgH > 0) y += blockGap - gap

            // 分隔线
            const dividerY = y
            ctx.strokeStyle = DIVIDER
            ctx.lineWidth = 2
            ctx.beginPath()
            ctx.moveTo(PAD, dividerY)
            ctx.lineTo(W - PAD, dividerY)
            ctx.stroke()

            // 统计
            const statsY = dividerY + 48
            ctx.fillStyle = MUTED
            ctx.font = smallFont + 'px ' + FONT
            ctx.fillText(statsLine, PAD, statsY)

            // 页脚：头像在作者信息与推文链接之前
            const footerTop = statsY + 32
            const ax = PAD, ay = footerTop
            if (avatarImg) {
                ctx.save()
                ctx.beginPath()
                ctx.arc(ax + avatarSize / 2, ay + avatarSize / 2, avatarSize / 2, 0, Math.PI * 2)
                ctx.closePath()
                ctx.clip()
                const side = Math.min(avatarImg.width, avatarImg.height)
                ctx.drawImage(avatarImg, (avatarImg.width - side) / 2, (avatarImg.height - side) / 2, side, side, ax, ay, avatarSize, avatarSize)
                ctx.restore()
                ctx.beginPath()
                ctx.arc(ax + avatarSize / 2, ay + avatarSize / 2, avatarSize / 2, 0, Math.PI * 2)
                ctx.strokeStyle = DIVIDER
                ctx.lineWidth = 2
                ctx.stroke()
            } else {
                ctx.beginPath()
                ctx.arc(ax + avatarSize / 2, ay + avatarSize / 2, avatarSize / 2, 0, Math.PI * 2)
                ctx.fillStyle = '#eff3f4'
                ctx.fill()
            }

            const tx = PAD + avatarSize + 28
            ctx.fillStyle = INK
            ctx.font = 'bold ' + nameFont + 'px ' + FONT
            ctx.fillText(authorName, tx, footerTop + 40)
            ctx.fillStyle = MUTED
            ctx.font = subFont + 'px ' + FONT
            ctx.fillText(handle + '  ·  ' + dateStr, tx, footerTop + 82)
            ctx.fillStyle = LINK
            ctx.font = smallFont + 'px ' + FONT
            ctx.fillText(tweetUrl, tx, footerTop + 122)

            return canvas.toDataURL('image/jpeg', 0.94)
        },
        showShareOverlay: function (dataUrl, fileName) {
            const overlay = document.createElement('div')
            overlay.className = 'tmd-share-overlay'
            overlay.style.cssText = 'position:fixed;left:0;top:0;width:100%;height:100%;background:rgba(0,0,0,.8);display:flex;justify-content:center;align-items:center;z-index:2147483647;'
            const img = document.createElement('img')
            img.src = dataUrl
            img.style.cssText = 'max-width:90%;max-height:88%;background:#fff;box-shadow:0 8px 40px rgba(0,0,0,.5);border-radius:4px;'
            const bar = document.createElement('div')
            bar.style.cssText = 'position:absolute;top:20px;right:20px;display:flex;gap:10px;'
            const btnDownload = document.createElement('button')
            btnDownload.textContent = (lang && lang.download) || 'Download'
            btnDownload.style.cssText = 'padding:8px 18px;font-size:15px;color:#fff;background:#1d9bf0;border:none;border-radius:6px;cursor:pointer;'
            btnDownload.onclick = () => {
                const a = document.createElement('a')
                a.href = dataUrl
                a.download = fileName
                document.body.appendChild(a)
                a.click()
                document.body.removeChild(a)
            }
            const btnClose = document.createElement('button')
            btnClose.textContent = (lang && lang.cancel) || 'Close'
            btnClose.style.cssText = 'padding:8px 18px;font-size:15px;color:#fff;background:#f4212e;border:none;border-radius:6px;cursor:pointer;'
            btnClose.onclick = () => overlay.remove()
            bar.appendChild(btnDownload)
            bar.appendChild(btnClose)
            overlay.appendChild(img)
            overlay.appendChild(bar)
            overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove() })
            document.body.appendChild(overlay)
        },
        status: function (btn, css, title, style) {
            if (css) {
                btn.classList.remove('download', 'completed', 'loading', 'failed', 'share')
                css.split(/\s+/).forEach(c => c && btn.classList.add(c))
            }
            if (title) btn.title = title
            if (style) btn.style.cssText = style
        },
        settings: async function () {
            const $element = (parent, tag, style, content, css) => {
                let el = document.createElement(tag)
                if (style) el.style.cssText = style
                if (typeof content !== 'undefined') {
                    if (tag == 'input') {
                        if (content == 'checkbox') el.type = content
                        else el.value = content
                    } else el.innerHTML = content
                }
                if (css) css.split(' ').forEach(c => el.classList.add(c))
                parent.appendChild(el)
                return el
            }
            let wapper = $element(document.body, 'div', 'position: fixed; left: 0px; top: 0px; width: 100%; height: 100%; background-color: #0009; z-index: 10;')
            let wapper_close
            wapper.onmousedown = e => { wapper_close = e.target == wapper }
            wapper.onmouseup = e => { if (wapper_close && e.target == wapper) wapper.remove() }
            let dialog = $element(wapper, 'div', 'position: absolute; left: 50%; top: 50%; transform: translateX(-50%) translateY(-50%); width: fit-content; width: -moz-fit-content; background-color: #f3f3f3; border: 1px solid #ccc; border-radius: 10px; color: black;')
            let title = $element(dialog, 'h3', 'margin: 10px 20px;', lang.dialog.title)
            let options = $element(dialog, 'div', 'margin: 10px; border: 1px solid #ccc; border-radius: 5px;')
            let save_history_label = $element(options, 'label', 'display: block; margin: 10px;', lang.dialog.save_history)
            let save_history_input = $element(save_history_label, 'input', 'float: left;', 'checkbox')
            save_history_input.checked = await GM_getValue('save_history', true)
            save_history_input.onchange = () => { GM_setValue('save_history', save_history_input.checked) }
            let clear_history = $element(save_history_label, 'label', 'display: inline-block; margin: 0 10px; color: blue;', lang.dialog.clear_history)
            clear_history.onclick = () => {
                if (confirm(lang.dialog.clear_confirm)) {
                    history = []
                    GM_setValue('download_history', [])
                }
            }
            let show_sensitive_label = $element(options, 'label', 'display: block; margin: 10px;', lang.dialog.show_sensitive)
            let show_sensitive_input = $element(show_sensitive_label, 'input', 'float: left;', 'checkbox')
            show_sensitive_input.checked = await GM_getValue('show_sensitive', false)
            show_sensitive_input.onchange = () => {
                show_sensitive = show_sensitive_input.checked
                GM_setValue('show_sensitive', show_sensitive)
            }
            let filename_div = $element(dialog, 'div', 'margin: 10px; border: 1px solid #ccc; border-radius: 5px;')
            let filename_label = $element(filename_div, 'label', 'display: block; margin: 10px 15px;', lang.dialog.pattern)
            let filename_input = $element(filename_label, 'textarea', 'display: block; min-width: 500px; max-width: 500px; min-height: 100px; font-size: inherit; background: white; color: black;', await GM_getValue('filename', default_filename))
            let filename_tags = $element(filename_div, 'label', 'display: table; margin: 10px;', `
<span class="tmd-tag" title="user name">{user-name}</span>
<span class="tmd-tag" title="The user name after @ sign.">{user-id}</span>
<span class="tmd-tag" title="example: 1234567890987654321">{status-id}</span>
<span class="tmd-tag" title="{date-time} : Posted time in UTC.\n{date-time-local} : Your local time zone.\n\nDefault:\nYYYYMMDD-hhmmss => 20201231-235959\n\nExample of custom:\n{date-time:DD-MMM-YY hh.mm} => 31-DEC-21 23.59">{date-time}</span><br>
<span class="tmd-tag" title="Text content in tweet.">{full-text}</span>
`)
            filename_input.selectionStart = filename_input.value.length
            filename_tags.querySelectorAll('.tmd-tag').forEach(tag => {
                tag.onclick = () => {
                    let ss = filename_input.selectionStart
                    let se = filename_input.selectionEnd
                    filename_input.value = filename_input.value.substring(0, ss) + tag.innerText + filename_input.value.substring(se)
                    filename_input.selectionStart = ss + tag.innerText.length
                    filename_input.selectionEnd = ss + tag.innerText.length
                    filename_input.focus()
                }
            })
            let btn_save = $element(title, 'label', 'float: right;', lang.dialog.save, 'tmd-btn')
            btn_save.onclick = async () => {
                await GM_setValue('filename', filename_input.value)
                wapper.remove()
            }
        },
        fetchJson: async function (status_id) {
            let base_url = `https://${host}/i/api/graphql/2ICDjqPd81tulZcYrtpTuQ/TweetResultByRestId`
            let variables = {
                'tweetId': status_id,
                'with_rux_injections': false,
                'includePromotedContent': true,
                'withCommunity': true,
                'withQuickPromoteEligibilityTweetFields': true,
                'withBirdwatchNotes': true,
                'withVoice': true,
                'withV2Timeline': true
            }
            let features = {
                'articles_preview_enabled': true,
                'c9s_tweet_anatomy_moderator_badge_enabled': true,
                'communities_web_enable_tweet_community_results_fetch': false,
                'creator_subscriptions_quote_tweet_preview_enabled': false,
                'creator_subscriptions_tweet_preview_api_enabled': false,
                'freedom_of_speech_not_reach_fetch_enabled': true,
                'graphql_is_translatable_rweb_tweet_is_translatable_enabled': true,
                'longform_notetweets_consumption_enabled': false,
                'longform_notetweets_inline_media_enabled': true,
                'longform_notetweets_rich_text_read_enabled': false,
                'premium_content_api_read_enabled': false,
                'profile_label_improvements_pcf_label_in_post_enabled': true,
                'responsive_web_edit_tweet_api_enabled': false,
                'responsive_web_enhance_cards_enabled': false,
                'responsive_web_graphql_exclude_directive_enabled': false,
                'responsive_web_graphql_skip_user_profile_image_extensions_enabled': false,
                'responsive_web_graphql_timeline_navigation_enabled': false,
                'responsive_web_grok_analysis_button_from_backend': false,
                'responsive_web_grok_analyze_button_fetch_trends_enabled': false,
                'responsive_web_grok_analyze_post_followups_enabled': false,
                'responsive_web_grok_image_annotation_enabled': false,
                'responsive_web_grok_share_attachment_enabled': false,
                'responsive_web_grok_show_grok_translated_post': false,
                'responsive_web_jetfuel_frame': false,
                'responsive_web_media_download_video_enabled': false,
                'responsive_web_twitter_article_tweet_consumption_enabled': true,
                'rweb_tipjar_consumption_enabled': true,
                'rweb_video_screen_enabled': false,
                'standardized_nudges_misinfo': true,
                'tweet_awards_web_tipping_enabled': false,
                'tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled': true,
                'tweetypie_unmention_optimization_enabled': false,
                'verified_phone_label_enabled': false,
                'view_counts_everywhere_api_enabled': true
            }
            let url = encodeURI(`${base_url}?variables=${JSON.stringify(variables)}&features=${JSON.stringify(features)}`)
            let cookies = this.getCookie()
            let headers = {
                'authorization': 'Bearer AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA',
                'x-twitter-active-user': 'yes',
                'x-twitter-client-language': cookies.lang,
                'x-csrf-token': cookies.ct0
            }
            if (cookies.ct0.length == 32) headers['x-guest-token'] = cookies.gt
            let tweet_detail = await fetch(url, { headers: headers }).then(result => result.json())
            let tweet_result = tweet_detail.data.tweetResult.result
            return tweet_result.tweet || tweet_result
        },
        getCookie: function (name) {
            let cookies = {}
            document.cookie.split(';').filter(n => n.indexOf('=') > 0).forEach(n => {
                n.replace(/^([^=]+)=(.+)$/, (match, name, value) => {
                    cookies[name.trim()] = value.trim()
                })
            })
            return name ? cookies[name] : cookies
        },
        storage: async function (value) {
            let data = await GM_getValue('download_history', [])
            let data_length = data.length
            if (value) {
                if (Array.isArray(value)) data = data.concat(value)
                else if (data.indexOf(value) < 0) data.push(value)
            } else return data
            if (data.length > data_length) GM_setValue('download_history', data)
        },
        storage_obsolete: function (is_remove) {
            let data = JSON.parse(localStorage.getItem('history') || '[]')
            if (is_remove) localStorage.removeItem('history')
            else return data
        },
        formatDate: function (i, o, tz) {
            let d = new Date(i)
            if (tz) d.setMinutes(d.getMinutes() - d.getTimezoneOffset())
            let m = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']
            let v = {
                YYYY: d.getUTCFullYear().toString(),
                YY: d.getUTCFullYear().toString(),
                MM: d.getUTCMonth() + 1,
                MMM: m[d.getUTCMonth()],
                DD: d.getUTCDate(),
                hh: d.getUTCHours(),
                mm: d.getUTCMinutes(),
                ss: d.getUTCSeconds(),
                h2: d.getUTCHours() % 12,
                ap: d.getUTCHours() < 12 ? 'AM' : 'PM'
            }
            return o.replace(/(YY(YY)?|MMM?|DD|hh|mm|ss|h2|ap)/g, n => ('0' + v[n]).substr(-n.length))
        },

        language: {
            en: { download: 'Download', completed: 'Download Completed', settings: 'Settings', share: 'Share Image', share_loading: 'Generating share image…', packaging: 'Packaging', dialog: { title: 'Download Settings', save: 'Save', save_history: 'Remember download history', clear_history: '(Clear)', clear_confirm: 'Clear download history?', show_sensitive: 'Always show sensitive content', pattern: 'ZIP File Name Pattern' }, original: 'Original Tweet', quote: 'Quoted Tweet', cancel: 'Cancel', choose: 'Select media to download' },
            ja: { download: 'ダウンロード', completed: 'ダウンロード完了', settings: '設定', share: '共有画像', share_loading: '共有画像を生成中…', packaging: 'パッケージ中', dialog: { title: 'ダウンロード設定', save: '保存', save_history: 'ダウンロード履歴を保存する', clear_history: '(クリア)', clear_confirm: 'ダウンロード履歴を削除する？', show_sensitive: 'センシティブな内容を常に表示する', pattern: 'ZIPファイル名の形式' }, original: '元のツイート', quote: '引用ツイート', cancel: 'キャンセル', choose: 'メディアを選択' },
            zh: { download: '下载', completed: '下载完成', settings: '设置', share: '生成分享图', share_loading: '正在生成分享图…', packaging: '打包中', dialog: { title: '下载设置', save: '保存', save_history: '保存下载记录', clear_history: '(清除)', clear_confirm: '确认要清除下载记录？', show_sensitive: '自动显示敏感的内容', pattern: '压缩包文件名格式' }, original: '原始推文', quote: '引用推文', cancel: '取消', choose: '选择要下载的媒体' },
            'zh-Hant': { download: '下載', completed: '下載完成', settings: '設置', share: '生成分享圖', share_loading: '正在生成分享圖…', packaging: '打包中', dialog: { title: '下載設置', save: '保存', save_history: '保存下載記錄', clear_history: '(清除)', clear_confirm: '確認要清除下載記錄？', show_sensitive: '自動顯示敏感的内容', pattern: '壓縮包文件名規則' }, original: '原始推文', quote: '引用推文', cancel: '取消', choose: '選擇要下載的媒體' }
        },
        css: `
.tmd-down {margin-left: 12px; order: 99;}
.tmd-down:hover > div > div > div > div {color: rgba(29, 161, 242, 1.0);}
.tmd-down:hover > div > div > div > div > div {background-color: rgba(29, 161, 242, 0.1);}
.tmd-down:active > div > div > div > div > div {background-color: rgba(29, 161, 242, 0.2);}
.tmd-down:hover svg {color: rgba(29, 161, 242, 1.0);}
.tmd-down:hover div:first-child:not(:last-child) {background-color: rgba(29, 161, 242, 0.1);}
.tmd-down:active div:first-child:not(:last-child) {background-color: rgba(29, 161, 242, 0.2);}
.tmd-media-btns {position: absolute; right: 0; top: 0; display: flex; gap: 2px; z-index: 10;}
.tmd-down.tmd-media {position: static;}
.tmd-down.tmd-media > div {display: flex; border-radius: 99px; margin: 2px;}
.tmd-down.tmd-media > div > div {display: flex; margin: 6px; color: #fff;}
.tmd-down.tmd-media:hover > div {background-color: rgba(255,255,255, 0.6);}
.tmd-down.tmd-media:hover > div > div {color: rgba(29, 161, 242, 1.0);}
.tmd-down.tmd-media:not(:hover) > div > div {filter: drop-shadow(0 0 1px #000);}
.tmd-down g {display: none;}
.tmd-down.download g.download, .tmd-down.completed g.completed, .tmd-down.loading g.loading, .tmd-down.failed g.failed, .tmd-down.share g.share {display: unset;}
.tmd-down.loading svg {animation: spin 1s linear infinite;}
@keyframes spin {0% {transform: rotate(0deg);} 100% {transform: rotate(360deg);}}
.tmd-btn {display: inline-block; background-color: #1DA1F2; color: #FFFFFF; padding: 0 20px; border-radius: 99px;}
.tmd-tag {display: inline-block; background-color: #FFFFFF; color: #1DA1F2; padding: 0 10px; border-radius: 10px; border: 1px solid #1DA1F2;  font-weight: bold; margin: 5px;}
.tmd-btn:hover {background-color: rgba(29, 161, 242, 0.9);}
.tmd-tag:hover {background-color: rgba(29, 161, 242, 0.1);}
.tmd-notifier {display: none; position: fixed; left: 16px; bottom: 16px; color: #000; background: #fff; border: 1px solid #ccc; border-radius: 8px; padding: 4px;}
.tmd-notifier.running {display: flex; align-items: center;}
.tmd-notifier label {display: inline-flex; align-items: center; margin: 0 8px;}
.tmd-notifier label:before {content: " "; width: 32px; height: 16px; background-position: center; background-repeat: no-repeat;}
.tmd-notifier label:nth-child(1):before {background-image:url("data:image/svg+xml;charset=utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%2216%22 height=%2216%22 viewBox=%220 0 24 24%22><path d=%22M3,14 v5 q0,2 2,2 h14 q2,0 2,-2 v-5 M7,10 l4,4 q1,1 2,0 l4,-4 M12,3 v11%22 fill=%22none%22 stroke=%22%23666%22 stroke-width=%222%22 stroke-linecap=%22round%22 /></svg>");}
.tmd-notifier label:nth-child(2):before {background-image:url("data:image/svg+xml;charset=utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%2216%22 height=%2216%22 viewBox=%220 0 24 24%22><path d=%22M12,2 a1,1 0 0 1 0,20 a1,1 0 0 1 0,-20 M12,5 v7 h6%22 fill=%22none%22 stroke=%22%23999%22 stroke-width=%222%22 stroke-linejoin=%22round%22 stroke-linecap=%22round%22 /></svg>");}
.tmd-notifier label:nth-child(3):before {background-image:url("data:image/svg+xml;charset=utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%2216%22 height=%2216%22 viewBox=%220 0 24 24%22><path d=%22M12,0 a2,2 0 0 0 0,24 a2,2 0 0 0 0,-24%22 fill=%22%23f66%22 stroke=%22none%22 /><path d=%22M14.5,5 a1,1 0 0 0 -5,0 l0.5,9 a1,1 0 0 0 4,0 z M12,17 a2,2 0 0 0 0,5 a2,2 0 0 0 0,-5%22 fill=%22%23fff%22 stroke=%22none%22 /></svg>");}
.tmd-down.tmd-img {position: absolute; right: 0; bottom: 0; display: none !important;}
.tmd-down.tmd-img > div {display: flex; border-radius: 99px; margin: 2px; background-color: rgba(255,255,255, 0.6);}
.tmd-down.tmd-img > div > div {display: flex; margin: 6px; color: #fff !important;}
.tmd-down.tmd-img:not(:hover) > div > div {filter: drop-shadow(0 0 1px #000);}
.tmd-down.tmd-img:hover > div > div {color: rgba(29, 161, 242, 1.0);}
:hover > .tmd-down.tmd-img, .tmd-img.loading, .tmd-img.completed, .tmd-img.failed {display: block !important;}
.tweet-detail-action-item {width: 20% !important;}
`,
        css_ss: `
/* show sensitive in media tab */
li[role="listitem"]>div>div>div>div:not(:last-child) {filter: none;}
li[role="listitem"]>div>div>div>div+div:last-child {display: none;}
`,
        svg: `
<g class="download"><path d="M3,14 v5 q0,2 2,2 h14 q2,0 2,-2 v-5 M7,10 l4,4 q1,1 2,0 l4,-4 M12,3 v11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" /></g>
<g class="completed"><path d="M3,14 v5 q0,2 2,2 h14 q2,0 2,-2 v-5 M7,10 l3,4 q1,1 2,0 l8,-11" fill="none" stroke="#1DA1F2" stroke-width="2" stroke-linecap="round" /></g>
<g class="loading"><circle cx="12" cy="12" r="10" fill="none" stroke="#1DA1F2" stroke-width="4" opacity="0.4" /><path d="M12,2 a10,10 0 0 1 10,10" fill="none" stroke="#1DA1F2" stroke-width="4" stroke-linecap="round" /></g>
<g class="failed"><circle cx="12" cy="12" r="11" fill="#f33" stroke="currentColor" stroke-width="2" opacity="0.8" /><path d="M14,5 a1,1 0 0 0 -4,0 l0.5,9.5 a1.5,1.5 0 0 0 3,0 z M12,17 a2,2 0 0 0 0,4 a2,2 0 0 0 0,-4" fill="#fff" stroke="none" /></g>
`,
        svg_share: `
<g class="share"><rect x="3" y="4" width="18" height="16" rx="2.5" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="8.5" cy="9.5" r="1.8" fill="currentColor"/><path d="M4.5 17.5 l4.8-4.8 3.4 3.4 2.8-2.8 4.2 4.2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></g>
`
    }
})()

TMD.init()
