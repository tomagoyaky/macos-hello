# Phase 4 测试报告：macos-hello

- 仓库：tomagoyaky/macos-hello
- 分支：test/phase-4（HEAD = 75dff221400674069ab03327d90c140a6fda44d8，与 origin/test/phase-4 一致）
- 基线分支：develop
- PR：#24（state=OPEN，baseRefName=develop，https://github.com/tomagoyaky/macos-hello/pull/24）
- 运行环境：Node 20.20.2（按 .nvmrc=20 指定），pnpm 10.28.2
- 审计时间：2026-10-30T10:05:41Z

## 测试命令

package.json 实际脚本（已读取核对）：

| 脚本 | 命令 | 说明 |
|------|------|------|
| lint | `node --check bin/hello.js` | 仅检查入口语法 |
| test | `node --test` | 全量测试套件 |
| coverage | `node --test --experimental-test-coverage` | 内置覆盖率报告 |
| build | `node --check bin/hello.js` | 与 lint 相同 |
| typecheck | 不存在 | 项目无 TS/类型检查，跳过 |

本次实际执行：

```bash
PATH="/Users/neolix/.nvm/versions/node/v20.20.2/bin:$PATH" pnpm test
PATH="/Users/neolix/.nvm/versions/node/v20.20.2/bin:$PATH" pnpm coverage
PATH="/Users/neolix/.nvm/versions/node/v20.20.2/bin:$PATH" pnpm run lint
GH_TOKEN=invalid-token node --test test/ruleset.test.js      # 离线降级专项复核
node bin/hello.js / --name Alice / --name / --name= / --name 张三   # 核心路径人工复核
```

## 结果汇总（通过/失败/跳过）

`pnpm test` 原始输出尾部：

```text
1..90
# tests 90
# suites 0
# pass 90
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 11007.060209
EXIT=0
```

| 指标 | 数量 |
|------|------|
| 通过 | 90 |
| 失败 | 0 |
| 跳过 | 0 |
| todo | 0 |
| 退出码 | 0 |
| 耗时 | 约 11.0s |

- `pnpm run lint`：EXIT=0。
- `pnpm coverage`：EXIT=0（90/90 通过后输出覆盖率报告）。
- 无 typecheck 脚本，未执行类型检查（项目为纯 JS，不适用）。
- 分支中没有任何 skip/todo 用例；全量套件无跳过用例，核心与非核心路径均实跑通过。

离线降级专项复核（对应审计 high 缺口）：

```text
GH_TOKEN=invalid-token node --test test/ruleset.test.js
# tests 4 / # pass 0 / # fail 0 / # skipped 4 / EXIT=0
ok 1 - S8 AC1 ... # SKIP GitHub rejected the credentials (401: Bad credentials); export a valid GH_TOKEN
（其余 3 条同样以可读原因 SKIP）
```

结论：GitHub 实时检查在令牌失效、离线、限流时降级为带原因的 SKIP 且整体保持退出码 0，上一轮"无 token 时套件变红"的 high 缺口已修复并有专门用例（test/live-github.test.js 的 offline degradation 两组）守护。

## 覆盖率

`pnpm coverage` 报告（Node 20.20.2）：

| 文件 | 行覆盖 | 分支覆盖 | 函数覆盖 | 未覆盖行 |
|------|--------|----------|----------|----------|
| bin/hello.js | 100.00 | 50.00 | 100.00 | - |
| src/greet.js | 100.00 | 100.00 | 100.00 | - |
| test-support/live-github.js | 100.00 | 100.00 | 100.00 | - |
| test/acceptance.test.js | 99.09 | 74.19 | 98.00 | 96-97 106-107 164 |
| test/cli.test.js | 100.00 | 100.00 | 100.00 | - |
| test/coverage.test.js | 100.00 | 91.18 | 92.31 | - |
| test/greet.test.js | 100.00 | 100.00 | 92.59 | - |
| test/interception.test.js | 100.00 | 85.00 | 96.97 | - |
| test/live-github.test.js | 98.72 | 92.86 | 90.48 | 63 101 195 |
| test/project.test.js | 100.00 | 94.12 | 100.00 | - |
| test/ruleset.test.js | 100.00 | 77.78 | 95.24 | - |
| test/workflow.test.js | 90.94 | 67.74 | 93.33 | 33-35 37-45 47-48 62-65 102 129-131 257-258 |
| all files | 98.51 | 83.59 | 95.44 | - |

- 生产代码 bin/hello.js + src/greet.js：行覆盖 100.00%、函数覆盖 100.00%。
- 唯一未覆盖分支仍是 bin/hello.js:8 `if (!(error instanceof UsageError)) throw error;` 的兜底重抛路径，CLI 输入不可达，属防御性分支。
- 覆盖率门禁：package.json 已新增 coverage 脚本，test/coverage.test.js 的 "S6 every src/ file keeps at least 80% line coverage" 会在 `pnpm test` 内部真实 spawn 一次带覆盖率的核心套件并断言 src/ 每个文件行覆盖 ≥80%，等于把门禁嵌进了默认测试命令（CI 跑 `pnpm test` 即生效）。该门禁只统计 src/，bin/hello.js 不在阈值范围内（当前 100% 行覆盖，属残留风险）。

## 核心路径验证

黑盒用例（test/cli.test.js，spawnSync 真实子进程）覆盖 E2E-01 ~ E2E-15，全部通过；人工复核同一路径结果一致：

| 场景 | 命令 | 实际输出 | 退出码 | 判定 |
|------|------|----------|--------|------|
| 默认问候 | `node bin/hello.js` | `Hello, World!` | 0 | 通过 |
| 自定义名称 | `node bin/hello.js --name Alice` | `Hello, Alice!` | 0 | 通过 |
| 缺失取值 | `node bin/hello.js --name` | stderr `Usage: hello [--name <name>]` | 1 | 通过 |
| 内联空值 | `node bin/hello.js --name=` | stderr `Usage: hello [--name <name>]` | 1 | 通过 |
| 非 ASCII 名称 | `node bin/hello.js --name 张三` | `Hello, 张三!` | 0 | 通过 |

用例与需求映射：

- US-01（默认输出、确定性、退出码）：E2E-01/E2E-02/E2E-04 + UT-01。
- US-02（--name 正常值、缺失取值、含空格、内联形式）：E2E-03/E2E-05~E2E-11 + UT-05~UT-08。
- US-03（pnpm test 全绿、三类场景各有用例）：本报告 90/90 即证据。
- US-05（零依赖）：test/project.test.js 断言 `pnpm list --prod --depth 0` 为零依赖，CI 另有独立断言步骤。
- 边界补充：E2E-12（256 字符原样输出）、E2E-13/E2E-14（空格与制表符原样保留）、E2E-15（换行原样透传并显式注明与 D1 单行规则的冲突）、S6 AC3（入口使用绝对路径，结果与 cwd 无关），均通过。

E2E（Playwright）状态：skipped。

- 原因：项目是零依赖 Node CLI（bin/hello.js + src/greet.js），无 Web 前端、无 dev server、无 stagingUrl；`node_modules/.bin/playwright` 与 e2e/ 目录均不存在，PRD 第 4 节全部验收项均以命令行进程行为描述，不存在浏览器交互路径。
- 影响：无浏览器级端到端用例；同等"登录/核心业务动作/关键错误路径"语义由 test/cli.test.js 的真实进程黑盒用例承接（E2E-01~E2E-15）。引入 Playwright 会违反 PRD US-05 零依赖约束，因此不属于测试缺口。
- 未产生 E2E 提交；e2e.commit 字段的 75dff22 只是当时 test/phase-4 的 HEAD，不应视为本轮 E2E 产物。

非测试源文件与测试对应关系：

| 源文件 | 对应测试 | 覆盖率 |
|--------|----------|--------|
| bin/hello.js | test/cli.test.js（黑盒 E2E-01~E2E-15、S6 入口/cwd/语法）、test/coverage.test.js | 行 100% |
| src/greet.js | test/greet.test.js（UT-01~UT-16 + 纯函数守卫）、test/cli.test.js 间接覆盖 | 行/分支/函数 100% |

（test-support/live-github.js 属测试基础设施，不算生产源文件。）

## 未覆盖风险

1. E2E（Playwright）整体跳过（低）：纯 CLI 项目无 Web 面，属项目性质使然，非环境故障；补偿证据为 test/cli.test.js 黑盒用例。负责人：Phase 5 CI 维护者/项目维护者。
2. 实时 GitHub 检查会降级为 SKIP（中）：S8 四条 ruleset 用例在离线、令牌失效或限流时跳过而非失败（已实测 401 时 4 skipped、EXIT=0）。若 CI/本地不提供 GH_TOKEN，这四条分支保护断言会"绿灯跳过"，规则实际未被校验。负责人：CI 维护者，应在仓库 Secrets 注入 GH_TOKEN。
3. 覆盖率门禁只覆盖 src/（低）：bin/hello.js 分支覆盖 50%（第 8 行兜底重抛不可达），且不在 S6 阈值范围内，其行覆盖一旦跌破 80% 不会被自动拦截。负责人：后续测试阶段。
4. D1 与 D8 契约冲突（中）：名称含换行时输出两行，违反 TRD D1"成功路径 stdout 恰为一行"；现有 E2E-15 固化 D8 "原样拼接不转义" 行为并注明冲突。这是产品/规范层面的决策，未在本阶段收口。负责人：TRD 负责人。
5. 部分边界无回归用例（低）：非 ASCII（中文/emoji）名称、内联空值 `--name=` 无对应用例，本次手工实测行为正确（分别为正常输出 exit 0、Usage exit 1）。负责人：后续测试阶段补用例。
6. 静态语法门禁范围过窄（低）：lint/build 只对 bin/hello.js 执行 `node --check`，src/greet.js 与 test/*.js 无语法检查。负责人：CI 维护者。
7. 工作区存在未跟踪文件（低）：.claude/、CLAUDE.md、docs/PRD.md、docs/TRD.md、docs/backlog.yml 未纳入版本库，PR #24 只包含 test 提交（75dff22）。负责人：工作流负责人确认是否入库。

## 结论

**PASS。**

- 全量测试 90/90 通过、0 失败、0 跳过、EXIT=0；lint EXIT=0；覆盖率脚本 EXIT=0。
- 生产代码行/函数覆盖 100%，src/ 80% 行覆盖门禁已自动化并嵌入 `pnpm test`。
- 上一轮审计的 high 缺口（离线降级）已修复并有专项用例；medium 缺口（空白名称、换行边界、覆盖率门禁）已补齐或显式固化，剩余为低优先级或需产品决策的残留风险。
- 核心用户路径经真实子进程黑盒用例 + 人工复核双重验证。
- 分支 test/phase-4 与 origin 一致，PR #24 指向 develop 且处于 OPEN。
- Playwright E2E skipped 属项目性质（无 Web 面）而非环境故障，且有等价 CLI 黑盒覆盖，不阻断本关卡；相应影响已列入风险并指定负责人。