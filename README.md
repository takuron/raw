# raw — takuron 的原始文件服务器

This repository is served as a static file server via GitHub Pages at **`https://raw.takuron.com`**. Any file pushed to the `main` branch is directly accessible through the same URL path.

本仓库通过 GitHub Pages 将整个目录作为静态文件服务器托管在 **`https://raw.takuron.com`** 域名下。推送到 `main` 分支的文件都会以相同的路径直接通过该域名访问。

## Usage 使用方法

Any file under this repository can be fetched directly. For example:

仓库内的任意文件都可以直接拉取，例如：

```bash
curl -fsSL https://raw.takuron.com/userscripts/pixiv-downloader.user.js
wget https://raw.takuron.com/vpsom_shell/setup/debian/debian12_setup.sh
```

## Directory Structure 目录结构

```
raw/
├── userscripts/                  # Userscripts 油猴脚本
│   ├── pixiv-downloader.user.js
│   ├── pixiv-downloader.meta.js
│   ├── pawchive-downloader.user.js
│   └── pawchive-downloader.meta.js
└── vpsom_shell/                  # 服务器初始化与 Docker 配置脚本
    ├── setup/                    # 服务器初始化脚本
    └── docker/                   # Docker Compose 服务配置
```

### userscripts/

Userscripts for Tampermonkey/Violentmonkey, usable directly with the `.user.js` / `.meta.js` URLs above.

油猴脚本（Tampermonkey/Violentmonkey），可直接使用上述 `.user.js` / `.meta.js` 链接安装。

### vpsom_shell/

Server initialization and Docker service configuration scripts, mirroring the [vpsom_shell](https://github.com/takuron/vpsom_shell) project. See [vpsom_shell/README.md](./vpsom_shell/README.md) for details.

服务器初始化与 Docker 服务配置脚本，对应 [vpsom_shell](https://github.com/takuron/vpsom_shell) 项目。详见 [vpsom_shell/README.md](./vpsom_shell/README.md)。

## License 许可证

This repository is licensed under the [Apache License 2.0](./LICENSE). The contents of `vpsom_shell/` were originally released under LGPL-2.1 by the same author and have been relicensed to Apache-2.0 here.

本仓库使用 [Apache License 2.0](./LICENSE)。`vpsom_shell/` 目录下的内容原以 LGPL-2.1 发布，因作者相同，此处已统一重新授权为 Apache-2.0。
