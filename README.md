# macos-hello

> 一个运行在 macOS 上的最小 Hello World 命令行程序：零运行时依赖、输出确定、可被自动化验证，用于验证「需求 → 设计 → 开发 → 测试 → CI → 交付」的端到端交付流程。

## 项目简介

macos-hello 是一个纯 JavaScript（ESM）命令行工具，只使用 Node.js 内置能力：

- 默认输出 `Hello, World!`，末尾恰一个换行，退出码 0，stderr 为空。
- 支持 `--name <name>` 与 `--name=<name>` 两种写法，输出 `Hello, <name>!`。
- 非法用法（缺失取值、空字符串、未知选项、位置参数、歧义取值）统一输出 `Usage: hello [--name <name>]` 到 stderr，退出码 1，stdout 为空。
- 零运行时依赖、零开发依赖、无构建步骤；不读环境变量、不访问网络、不写文件。
- 使用 `node:test` 与 GitHub Actions 保证回归质量，测试结果与 CI 日志一致。

当前状态：10 条 Story 全部完成，对应 Issue 已关闭、PR 已合并，测试 90 条全部通过。详细核对结果与未验证事项见 [交付总结](docs/delivery-summary.md)。

## 支持范围

| 项目 | 支持版本 |
|------|----------|
| 操作系统 | macOS（CI 在 `ubuntu-latest` 上运行，仅用于持续集成） |
| 运行时 | Node.js 20.x（`engines.node` 为 `>= 20`，CI 固定 `20.x`） |
| 包管理器 | pnpm 10.28.2（`packageManager` 已钉住） |

本地 Node.js 版本必须与 CI 保持一致，其他大版本不在承诺范围内。仓库内 `.nvmrc` 已固定为 `20`，使用 nvm 时执行 `nvm use` 即可对齐。

> Node.js 20 已于 2026-04 结束上游维护，升级计划与风险记录见 [交付总结](docs/delivery-summary.md) 第 6 节。

## 快速开始

前置条件：已安装 Node.js 20.x，且位于仓库根目录。

```bash
corepack enable
pnpm install --frozen-lockfile
node bin/hello.js
```

预期输出：

```text
Hello, World!
```

`corepack enable` 会按 `packageManager` 字段启用 pnpm 10.28.2，无需单独安装。不使用 corepack 时也可全局安装：

```bash
npm install -g pnpm@10.28.2
```

项目无第三方依赖，`pnpm install` 只用于生成 `node_modules` 并校验锁文件；即使不安装，`node bin/hello.js` 也能直接运行。

## 使用

```bash
node bin/hello.js
node bin/hello.js --name Alice
node bin/hello.js --name=Alice
node bin/hello.js --name "Wu Ming"
```

| 命令 | 输出 / 说明 |
|------|-------------|
| `node bin/hello.js` | `Hello, World!`，退出码 0 |
| `node bin/hello.js --name Alice` | `Hello, Alice!`，退出码 0 |
| `node bin/hello.js --name=Alice` | 内联写法，与 `--name Alice` 等价 |
| `node bin/hello.js --name "Wu Ming"` | 含空格的值原样输出：`Hello, Wu Ming!` |
| `node bin/hello.js --name` | stderr 输出 `Usage: hello [--name <name>]`，退出码 1 |
| `node bin/hello.js --name ""` | 同缺失取值，退出码 1 |
| `node bin/hello.js --foo` / `--help` / `-h` / `extra` | 视为非法用法，stderr 输出 Usage，退出码 1 |

## 常用命令

下表与 `package.json` 的 `scripts` 一致；未定义的动作为「未配置」。

| 动作 | 命令 | scripts 定义 | 说明 |
|------|------|--------------|------|
| install | `pnpm install --frozen-lockfile` | 未配置（直接调用 pnpm） | 校验锁文件；项目无依赖，实际为空操作 |
| dev | 未配置 | — | 无开发服务器，直接执行 `node bin/hello.js` |
| lint | `pnpm lint` | `node --check bin/hello.js` | 入口语法预检 |
| typecheck | 未配置 | — | 纯 JavaScript，无 TypeScript |
| test | `pnpm test` | `node --test` | 自动发现 `test/*.test.js` 并运行全量用例 |
| coverage | `pnpm coverage` | `node --test --experimental-test-coverage` | 内置覆盖率报告 |
| build | `pnpm build` | `node --check bin/hello.js` | 无构建产物，源码即运行时产物 |

## 架构说明

```text
macos-hello/
├── bin/hello.js              # CLI 适配层：唯一允许触碰 process 的文件（stdout / stderr / exitCode）
├── src/greet.js              # 纯函数核心：formatGreeting / parseCliArgs / UsageError
├── test/                     # 单元测试、黑盒验收测试与契约测试
├── test-support/             # 测试基础设施（GitHub 实时检查的降级封装）
├── .github/workflows/ci.yml  # GitHub Actions：lint / test / build / deploy-staging
├── docs/                     # PRD、TRD、backlog、测试报告、运行手册、交付总结
├── .nvmrc                    # Node 版本 20
├── package.json              # 包清单与脚本
└── pnpm-lock.yaml            # 锁文件
```

处理流程：

1. `bin/hello.js` 读取 `process.argv.slice(2)`，交给 `parseCliArgs`。
2. `parseCliArgs` 使用 `node:util.parseArgs` 的 strict 模式解析 `--name`，禁止位置参数与未知选项；所有解析异常统一包装为 `UsageError`。
3. 成功路径由 `formatGreeting(name = 'World')` 生成 `Hello, <name>!`，追加一个换行写入 stdout。
4. 失败路径向 stderr 写入 `Usage: hello [--name <name>]`，通过 `process.exitCode = 1` 结束（不使用 `process.exit`，避免管道输出被截断）。

约束与依赖方向：

- `src/` 内全部是纯函数，不读取 `process`、环境变量、时钟或随机数；副作用只出现在 `bin/hello.js`。
- 依赖方向单向：`test → bin/src`，`bin → src`；`src` 不反向依赖任何上层组件。
- 输出模板只在 `formatGreeting` 维护一处，解析层与测试不复制字符串。

## 测试

```bash
pnpm test        # 全量用例，当前 90 条
pnpm coverage    # 覆盖率报告（生产代码行/函数覆盖 100%）
pnpm lint
pnpm build
```

测试分层：

| 文件 | 类型 | 覆盖内容 |
|------|------|----------|
| `test/greet.test.js` | 单元测试 | 直接 `import src/greet.js`，UT-01~UT-16，含各异常路径的 `UsageError` 断言 |
| `test/cli.test.js` | 黑盒验收 | `spawnSync` 运行真实进程，E2E-01~E2E-15，整串比对 stdout / stderr / 退出码 |
| `test/project.test.js` | 契约 | 零依赖与 `package.json` 字段契约 |
| `test/workflow.test.js` | 契约 | CI 工作流结构、权限、零依赖断言步骤 |
| `test/ruleset.test.js` | 契约 | `main` 分支 ruleset（需 `GH_TOKEN`，无令牌时按设计 SKIP） |
| `test/live-github.test.js` | 集成 | GitHub 实时检查的离线降级行为 |
| `test/acceptance.test.js` | 验收 | S10 端到端验收场景复跑 |
| `test/coverage.test.js` | 门禁 | `src/` 每个文件行覆盖 ≥ 80%，嵌入默认测试命令 |
| `test/interception.test.js` | 演练 | 变异后测试可拦截回归（S9） |

注意事项：

- 未配置 `GH_TOKEN` 时，4 条线上 ruleset 检查会以降级 SKIP 通过，整轮测试仍为绿；需要真实校验分支保护时，请注入具备仓库 administration 读权限的令牌。
- 部分验收用例依赖 GitHub 实时 API；断网、令牌失效或限流时可能失败或跳过，属环境因素。
- Node 20 下完整测试与覆盖率报告见 [测试报告](docs/test-report.md)。

持续集成：推送到 `develop` 或向 `develop` 提交 PR 时触发 [`.github/workflows/ci.yml`](.github/workflows/ci.yml)，包含 `lint`、`test`、`build` 三个检查 job 与 `deploy-staging` 占位 job。`test` job 在 Node.js 20.x 上运行 `pnpm test`，并执行零运行时依赖断言（日志输出 `runtime dependencies: 0`），同时上传 artifact `test-report`。

## 部署

当前**没有真实部署目标**：`.github/workflows/ci.yml` 中的 `deploy-staging` 是占位实现，只校验 `STAGING_DEPLOY_KEY` 非空、打印将要部署的版本，然后在 CI runner 上执行本机冒烟检查。job 显示绿色**不代表**已发布到预发环境。

- 部署、冒烟、回滚与故障处理的完整步骤：[部署运行手册](docs/deployment-runbook.md)。
- 本地复现 CI 全量校验：

  ```bash
  pnpm install --frozen-lockfile
  pnpm lint
  for file in bin/*.js src/*.js test/*.js test-support/*.js; do node --check "$file"; done
  pnpm test
  pnpm build
  node bin/hello.js
  ```

部署状态以「部署未验证」标注，接入真实 staging 目标并完成首次人工验证后再更新本节。

## 文档索引

| 文档 | 内容 |
|------|------|
| [docs/PRD.md](docs/PRD.md) | 产品需求：背景、用户故事、验收标准、成功指标、里程碑 |
| [docs/TRD.md](docs/TRD.md) | 技术设计：架构、契约、错误处理、测试策略 |
| [docs/backlog.yml](docs/backlog.yml) | Story 清单 S1~S10，含依赖关系与验收条目 |
| [docs/delivery-summary.md](docs/delivery-summary.md) | 交付总结：阶段汇总、功能完成度、指标判定、剩余风险 |
| [docs/deployment-runbook.md](docs/deployment-runbook.md) | 部署运行手册：前置条件、部署、冒烟、回滚、故障处理 |
| [docs/workflow-runbook.md](docs/workflow-runbook.md) | 交付工作流运行手册：7 阶段流程、状态与遥测、校验命令 |
| [docs/test-report.md](docs/test-report.md) | Phase 4 测试报告：用例、覆盖率、残留风险 |
| [docs/acceptance/S10-acceptance.json](docs/acceptance/S10-acceptance.json) | S10 端到端验收记录（命令行输出、CI 链接、指标核对） |
| [docs/drill/S9-test-interception.json](docs/drill/S9-test-interception.json) | S9 测试拦截演练记录 |
| [CLAUDE.md](CLAUDE.md) | 项目规范：技术栈、命令、Gitflow、测试与交付要求 |

## 开发约定

- 分支：`develop` 为日常基线；功能/修复/杂务分别用 `feature/<story-id>`、`fix/<desc>`、`chore/<desc>`。
- 提交信息：`<type>(<scope>): <描述>`，类型为 `feat` / `fix` / `docs` / `chore` / `refactor` / `test` / `perf` / `ci` / `style`。
- 合并规则：`main` 受 ruleset `main-protection` 保护，必须经 PR 合并且 `test` 检查通过，禁止强制推送与删除分支。
- 开发规范与 TDD 要求的完整版本见 [CLAUDE.md](CLAUDE.md)。

## 许可

`package.json` 声明 `private: true`，项目不发布到 npm 公共仓库，仅供内部工作流验证使用。仓库未提供独立的 LICENSE 文件。