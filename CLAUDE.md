# macos-hello

## 项目概览

macos-hello 是一个运行在 macOS 上的最小 Hello World 命令行程序，作为端到端交付工作流的验证载体：从需求、开发、测试、CI 到交付验收，用最小成本走通全链路。

- 默认问候：`node bin/hello.js` 输出 `Hello, World!`（单行，末尾恰一个换行，退出码 0，stderr 为空）
- 自定义问候：`node bin/hello.js --name Alice` 输出 `Hello, Alice!`
- 非法用法（缺失取值、空字符串、未知选项、位置参数、歧义取值）：stderr 输出 `Usage: hello [--name <name>]`，退出码 1，stdout 为空
- 硬约束：零运行时依赖、零开发依赖、无构建步骤；不读环境变量、不访问网络、不写文件
- 文档索引：需求 [`docs/PRD.md`](docs/PRD.md)｜设计 [`docs/TRD.md`](docs/TRD.md)｜故事清单 [`docs/backlog.yml`](docs/backlog.yml)

## 技术栈与目录结构

**技术栈**

| 领域 | 选型 |
|------|------|
| 运行时 | Node.js 20.x（`engines.node >= 20`，CI 固定 `20.x`，本地用 `.nvmrc` 对齐） |
| 语言 / 模块 | JavaScript + ESM（`"type": "module"`），无 TypeScript、无构建步骤 |
| 包管理器 | pnpm 10.28.2（`packageManager` 钉住；`pnpm-lock.yaml` 必须提交） |
| 参数解析 | `node:util.parseArgs`（strict 模式，禁止位置参数），错误统一包装为 `UsageError` |
| 测试 | `node:test` + `node:assert/strict`，运行命令 `node --test` |
| CI | GitHub Actions：`ubuntu-latest` + Node.js 20.x，job 名固定为 `test` |

本地 Node 必须是 20.x（TRD TR-02：本地与 CI 版本不一致会导致行为漂移）。当前仓库尚未提交 `.nvmrc`。

**目录结构**

```text
macos-hello/
├── bin/hello.js              # CLI 适配层：唯一允许触碰 process 的文件（待实现）
├── src/greet.js              # 纯函数核心：formatGreeting / parseCliArgs / UsageError（待实现）
├── test/greet.test.js        # 单元测试 UT-01~UT-14（待实现）
├── test/cli.test.js          # 黑盒验收测试 E2E-01~E2E-12（待实现）
├── .github/workflows/ci.yml  # GitHub Actions 工作流（待实现）
├── .nvmrc                    # Node 版本 20（待新增）
├── docs/PRD.md               # 产品需求文档
├── docs/TRD.md               # 技术设计文档
├── docs/backlog.yml          # 故事清单 S1~S10，base_branch 为 develop
├── docs/.workflow/           # 工作流状态（state.json）与遥测事件（events/）
├── package.json              # 包清单与脚本
├── pnpm-lock.yaml            # 锁文件
├── .gitignore                # 忽略 node_modules/、dist/、coverage/、.DS_Store、*.log
└── README.md                 # 使用说明
```

依赖方向单向：`test → bin/src`，`bin → src`；`src` 不得反向依赖任何上层组件。

## 常用命令

下表与 `package.json` 的 `scripts` 完全一致；脚本中未定义的动作为「未配置」。

| 动作 | 命令 | scripts 定义 | 说明 |
|------|------|--------------|------|
| install | 未配置 | — | scripts 中无 install；安装依赖直接用 `pnpm install --frozen-lockfile` |
| dev | 未配置 | — | 无开发服务器，直接执行 `node bin/hello.js` |
| lint | `pnpm lint` | `node --check bin/hello.js` | 目前仅为入口语法预检 |
| typecheck | 未配置 | — | 纯 JS 无 tsc；类型语义只在 JSDoc 中表达 |
| test | `pnpm test` | `node --test` | 自动发现 `*.test.js`；新增测试文件必须遵循该命名 |
| build | `pnpm build` | `node --check bin/hello.js` | 无构建产物，源码即运行时产物 |

直接运行（不经过 scripts）：

```bash
node bin/hello.js                 # Hello, World!
node bin/hello.js --name Alice    # Hello, Alice!
node bin/hello.js --name "Wu Ming"
node bin/hello.js --name=Alice    # 内联形式，与 --name Alice 等价
```

注意：`lint` / `build` 检查的目标 `bin/hello.js` 目前尚不存在，脚本会在故事 S2 实现前报错退出。

## 开发规范

**Gitflow**

- `develop` 为日常基线分支（`backlog.yml` 的 `base_branch`），所有改动从它切出。
- 功能分支：`feature/<story-id>`，如 `feature/S2`（对应 backlog 中的故事编号 S1~S10）。
- 修复分支：`fix/<desc>`。
- 杂务分支：`chore/<desc>`。
- `main` 受 Repository ruleset 保护：必须经 PR 合并，必需状态检查 `test` 通过；禁止强制推送与删除分支；不要求人工批准（适配单人维护）。

**提交信息格式**

```text
<type>(<scope>): <描述>
```

`type` 取值：`feat` | `fix` | `docs` | `chore` | `refactor` | `test` | `perf` | `ci` | `style`。

示例：`feat(cli): 支持 --name 自定义问候`、`test(cli): 补充 E2E-05 缺失取值用例`。

**代码约定**

- `src/` 内全部是纯函数；副作用（stdout / stderr / exitCode）只允许出现在 `bin/hello.js`。
- 输出模板只维护一处（`formatGreeting`），解析层与测试不得复制字符串。
- 退出码通过 `process.exitCode` 设置，不使用 `process.exit`（避免管道输出被截断）。
- 成功路径的 stdout 只含产品输出本身，不得混入日志、时间戳或警告。
- 不引入任何第三方依赖（运行时与开发期均为 0），不新增构建步骤。
- README / 文档 / 提交描述用中文，代码注释用英文。

## 测试要求

- TDD：先提交失败测试（红态），再写实现转绿，最后重构；不得先写实现后补测试。
- 全量测试通过（`pnpm test` 失败数为 0，退出码 0）才能提交 PR。
- 两层测试，缺一不可：
  - `test/greet.test.js`：单元测试，直接 `import` `src/greet.js`、不创建子进程，覆盖 UT-01~UT-14；异常路径各至少 1 条并断言抛出 `UsageError`。
  - `test/cli.test.js`：黑盒验收测试，`spawnSync(process.execPath, [CLI_PATH, ...args])` 运行真实进程，覆盖 E2E-01~E2E-12；入口路径用 `fileURLToPath(new URL('../bin/hello.js', import.meta.url))` 解析，不依赖当前工作目录。
- 断言使用整串 `strictEqual` 同时比对 stdout（含换行）、stderr、退出码，例如 `strictEqual(result.stdout, 'Hello, World!\n')`。
- 三类必需场景各至少 1 条用例：默认输出、`--name` 正常值、`--name` 缺失取值。
- 用例名称带 US 编号前缀（如 `US-01 default greeting`），便于 CI 失败时定位对应验收标准。
- 覆盖率：本地用 `node --test --experimental-test-coverage`，`src/` 行覆盖率目标 ≥ 80%；不做 CI 门禁（Node 20 无覆盖率阈值参数，加门禁会引入依赖）。

## 交付流程

远端仓库为 `tomagoyaky/macos-hello`（私有），基线分支 `develop`。

1. 从 `develop` 切 `feature/<story-id>` 或 `fix/<desc>` / `chore/<desc>` 分支。
2. 按 TDD 实现，本地 `pnpm test` 全绿并留存命令输出作为证据。
3. 推送触发 GitHub Actions（job `test`，含零依赖断言）；CI 全绿后提 PR 合并。
4. 每个里程碑完成即推送一次并留存 CI 运行链接；CI 失败先修复，再推进下一个里程碑。

流程与阶段状态的唯一事实来源：

- [`docs/workflow-runbook.md`](docs/workflow-runbook.md) —— 交付运行手册（工作流生成；尚未生成时以工作流产物为准）
- [`docs/.workflow/state.json`](docs/.workflow/state.json) —— 各阶段状态与已执行命令；遥测事件见 `docs/.workflow/events/`

## 环境与密钥

本程序不读取任何环境变量，运行不需要任何密钥。只有与 GitHub 交互时才涉及以下变量：

| 变量名 | 用途 | 提供方式 |
|--------|------|----------|
| `GH_TOKEN` | 本地 `gh` CLI / 脚本调用 GitHub API 的凭据 | 本地 shell 环境变量 |
| `GITHUB_TOKEN` | 工作流内调用 GitHub API 的凭据 | GitHub Actions 自动注入 |
| `CI` | 标记运行在 CI 环境（非密钥） | GitHub Actions 自动设置 |

规则：

- 只通过环境变量或 GitHub Secrets 注入，禁止把任何 token、密码、证书内容写进仓库、文档、示例或 CI 日志。
- 上述变量只列名称，不得在文档或代码中记录取值。
- 当前 `.gitignore` 未包含 `.env*`；如需本地密钥文件，先补充忽略规则再使用。