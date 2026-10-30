# macos-hello

一个运行在 macOS 上的最小 Hello World 命令行程序，用于验证端到端交付流程（需求 → 开发 → 测试 → CI → 交付）。

## 支持范围

| 项目 | 支持版本 |
|------|----------|
| 操作系统 | macOS |
| 运行时 | Node.js 20.x（`engines.node` 为 `>= 20`，CI 固定 20.x） |
| 包管理器 | pnpm 10.28.2（`packageManager` 已钉住） |

版本必须与 CI 保持一致，其他 Node.js 大版本不在支持范围内。仓库内 `.nvmrc` 已固定为 `20`，使用 nvm 时执行 `nvm use` 即可对齐。

## 安装

本项目零运行时依赖、零开发依赖、无构建步骤，安装仅用于生成 `node_modules` 并校验锁文件：

```bash
corepack enable
pnpm install --frozen-lockfile
```

`corepack enable` 会按 `packageManager` 字段启用 pnpm 10.28.2，无需单独安装。不使用 corepack 时也可全局安装：

```bash
npm install -g pnpm@10.28.2
```

## 使用

```bash
node bin/hello.js
node bin/hello.js --name Alice
node bin/hello.js --name=Alice
```

| 命令 | 输出 / 说明 |
|------|-------------|
| `node bin/hello.js` | `Hello, World!` |
| `node bin/hello.js --name Alice` | `Hello, Alice!` |
| `node bin/hello.js --name=Alice` | 内联写法，与 `--name Alice` 等价 |

运行测试：

```bash
pnpm test
```

> 注：CLI 入口 `bin/hello.js` 由故事 S2 交付，在此之前上述运行命令会因入口缺失而报错。

## 许可

私有项目，仅供内部工作流验证使用。
<!-- S8 AC2: temporary passing PR merged to main to verify ruleset allows merged checks. -->
