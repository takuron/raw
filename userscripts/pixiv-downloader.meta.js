// ==UserScript==
// @name        Pixiv 图片下载提取版 (极速打包+自定义命名)
// @namespace   https://github.com/takuron/raw
// @version     1.0.5
// @description 提取了 Pixiv Plus 脚本的图片下载功能，支持自定义命名格式与空格替换，使用 STORE 模式极速打包 ZIP。
// @author      Ahaochan Takuron
// @updateURL    https://raw.takuron.com/userscripts/pixiv-downloader.meta.js
// @downloadURL  https://raw.takuron.com/userscripts/pixiv-downloader.user.js
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
