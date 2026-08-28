# VPSOM_Shell 服务器配置脚本

> This directory mirrors the [vpsom_shell](https://github.com/takuron/vpsom_shell) project. The original project is still maintained; issues and pull requests are recommended there.
>
> 本目录对应 [vpsom_shell](https://github.com/takuron/vpsom_shell) 项目。原项目仍在维护，相关问题与 PR 建议在原项目提出。

## Project Introduction 项目介绍

This directory contains some server initialization/configuration scripts for personal use, generated with the assistance of generative AI. Specific functional descriptions can be found in the comments within the scripts. Most of these scripts have been verified as functional and are currently in use; they can be directly applied to configure servers or used as references to create your own initialization scripts.

这里收录了一些自用的服务器初始化/配置脚本，由生成式人工智能辅助生成，具体功能介绍请参考脚本内注释。大部分脚本已经过验证可用并正在使用，可以直接套用配置服务器或用于参考制作自己的初始化脚本。

## Folder Introduction 文件夹介绍

```
vpsom_shell/
├── setup/
│   └── debian/
│       └── debian12_setup.sh      # Debian 12 交互式初始化脚本
│                                  # (更新系统 / BBR+CAKE / SSH加固 / UFW / Docker / Web服务器 / 修改root密码)
└── docker/
    ├── freshrss/                  # FreshRSS + PostgreSQL + Watchtower 自动更新
    ├── vaultwarden/               # Vaultwarden + rclone WebDAV 自动备份 + Watchtower
    ├── memu/                      # MemU Server (LLM记忆服务)
    └── openwebui/                 # OpenWebUI 前端
```

## Online Access 在线访问

The files in this directory are served via GitHub Pages at `https://raw.takuron.com/vpsom_shell/...`.

本目录文件已通过 GitHub Pages 托管于 `https://raw.takuron.com/vpsom_shell/...`，例如：

- `https://raw.takuron.com/vpsom_shell/setup/debian/debian12_setup.sh`
- `https://raw.takuron.com/vpsom_shell/docker/freshrss/docker-compose.yml`

You can download them directly with `curl`/`wget`:

可以直接用 `curl`/`wget` 拉取，例如：

```bash
curl -fsSL https://raw.takuron.com/vpsom_shell/setup/debian/debian12_setup.sh -o debian12_setup.sh
```
