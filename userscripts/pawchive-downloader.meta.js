// ==UserScript==
// @name         Pawchive 批量打包下载
// @namespace    https://github.com/takuron/raw
// @version      1.0.0
// @author       Takuron
// @license      Apache-2.0
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
