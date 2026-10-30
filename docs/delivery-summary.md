# 交付总结：macos-hello

> 生成阶段：Phase 6「交付」｜生成时间：2026-10-30｜执行者：Technical Writer（Phase 6 交付文档子代理）｜DRY_RUN=false
>
> 核对基线：`develop` HEAD `23da245`（`chore: add gitflow guard hooks`）。依据材料：`docs/.workflow/state.json`、`docs/.workflow/phase-0.json` ~ `phase-5.json`、`docs/.workflow/story-S1-gate.json` ~ `story-S10-gate.json`、`docs/test-report.md`、`docs/deployment-runbook.md`、`docs/acceptance/S10-acceptance.json`，以及 2026-10-30 对 GitHub 仓库的线上复核（`gh repo view` / `gh issue list` / `gh pr list` / `gh run list` / `gh run view` / `gh api`）。
>
> 阅读约定：每条结论后的括号内为证据来源；没有可复核证据的能力一律标注「未验证」，不视为已完成。

## 1. 项目概览

macos-hello 是一个运行在 macOS 上的最小 Hello World 命令行程序，用于以最小成本走通「需求 → 设计 → 开发 → 测试 → CI → 交付验收」的端到端交付链路。项目零运行时依赖、零开发依赖、无构建步骤，纯 JavaScript ESM 实现。

| 维度 | 内容 | 证据 |
|------|------|------|
| 仓库 | `tomagoyaky/macos-hello`，默认分支 `develop` | `gh repo view` 输出 `defaultBranchRef.name=develop` |
| 运行时 | Node.js 20.x（`engines.node >= 20`，`.nvmrc` 为 `20`，CI 固定 `node-version: 20.x`） | `package.json`、`.nvmrc`、`.github/workflows/ci.yml` |
| 包管理器 | pnpm 10.28.2（`packageManager` 钉住） | `package.json`、`pnpm-lock.yaml` |
| 生产代码 | `bin/hello.js`（10 行，副作用层）+ `src/greet.js`（45 行，纯函数层） | `wc -l bin/*.js src/*.js` |
| 测试 | 90 条用例，全部通过（本地实跑与 CI 一致） | 见第 5 节 |
| 第三方依赖 | 运行时 0、开发期 0 | `package.json` 四类依赖字段为空；CI 步骤输出 `runtime dependencies: 0` |
| 部署 | `.github/workflows/ci.yml` 的 `deploy-staging` 为占位实现，**部署未验证** | `docs/deployment-runbook.md` 首段；CI 日志 `Deployment not verified` |

产品能力：

| 场景 | 命令 | 输出 / 行为 |
|------|------|-------------|
| 默认问候 | `node bin/hello.js` | stdout 恰为 `Hello, World!` 加一个换行（16 字节），exit 0，stderr 为空 |
| 具名问候 | `node bin/hello.js --name Alice`（等价 `--name=Alice`） | `Hello, Alice!`，exit 0 |
| 非法用法 | `--name` 缺值、`--name ""`、`--foo`、`--help`、`-h`、位置参数、`--name -x` | stderr 为 `Usage: hello [--name <name>]`，exit 1，stdout 为空 |

证据：2026-10-30 实跑 `node bin/hello.js | od -c` 输出 `H e l l o ,   W o r l d ! \n`（16 字节）；`node bin/hello.js --name Alice`、`--name=Alice` 均输出 `Hello, Alice!`；`node bin/hello.js --name` 实测 exit=1、stdout 0 字节、stderr `Usage: hello [--name <name>]`；另见 `docs/acceptance/S10-acceptance.json` 的 SC1/SC2 与 `test/cli.test.js`。

## 2. 阶段执行汇总

阶段严格串行，任一阶段关卡未通过即停止。下表内容来自 `docs/.workflow/phase-0.json` ~ `phase-5.json` 的 `status`、`tool_used`、`artifacts`、`gate` 字段。

| Phase | 状态 | 使用工具 | 交付物 | 关卡结果 |
|-------|------|----------|--------|----------|
| Phase 0 环境预检 | pass | Bash、gh CLI、jq、yq、python3 | `docs/.workflow/phase-0.json`、`docs/.workflow/state.json` | pass（环境预检：仓库、身份、权限、工具链、网络全部通过；当时 `visibility=PRIVATE`、默认分支 `develop`、gh 已登录） |
| Phase 1 立项与需求 | pass | Read、Bash、python3（yaml.safe_load / 依赖环检测）、gh CLI、Reality Checker 子代理 | `docs/PRD.md`、`docs/TRD.md`、`docs/backlog.yml`、`docs/.workflow/phase-1.json` | pass（文档质量关卡 8 项全过；PRD/TRD/backlog 齐备） |
| Phase 2 环境初始化 | pass | Bash、Read、python3、gh CLI（label / milestone / issue）、jq、Reality Checker 子代理 | `docs/.workflow/bootstrap-plan.json`、`docs/backlog.yml`、`CLAUDE.md`、`docs/.workflow/phase-2.json` | pass（bootstrap 产物关卡 7 项；Issue #1-#11 已创建） |
| Phase 3 Gitflow 开发 | pass | TDD 子代理、Code Reviewer、gh CLI / gh api、git（含 gitflow-hooks）、node --test、pnpm、perl（临时副本变异验证）、jq | `docs/.workflow/story-S1-gate.json` ~ `story-S10-gate.json`（10 个）、`docs/.workflow/phase-3.json`、PR #12-#19、#22、#23 | pass（10/10 Story 关卡通过；gate evidence 11534 字符） |
| Phase 4 测试 | pass | Node.js 20.20.2、pnpm 10.28.2（test / coverage / lint）、Reality Checker 子代理、gh CLI、git；Playwright 未安装（E2E 判定 skipped） | `docs/test-report.md`、`docs/.workflow/phase-4.json`、PR #24（MERGED 2026-10-30T10:08:50Z） | pass（90/90、fail 0、EXIT=0；lint/coverage EXIT=0；生产代码行覆盖 100%） |
| Phase 5 CI/CD | pass | Reality Checker 子代理、yq、gh CLI（run / environments / secrets）、git、pnpm + Node 20.20.2、python3 | `.github/workflows/ci.yml`、`docs/deployment-runbook.md`、`docs/.workflow/phase-5.json`、CI run [41041046753](https://github.com/tomagoyaky/macos-hello/actions/runs/41041046753) | pass（CI/CD 关卡 9 项；lint/test/build/deploy-staging 四 job 全 success；deploy-staging 为占位，部署未验证） |
| Phase 6 交付 | 执行中（本阶段） | Technical Writer 子代理、Read、Bash、gh CLI / gh api（线上复核） | `docs/delivery-summary.md`（本文件）、`README.md`（已更新） | 待 Phase 6 关卡核对；本文件不预判结果 |

补充事实：

- 全部 10 条 Story 均为「Issue 已关闭 + PR 已合并」，未发现「Issue 关闭但无 PR」或「PR 合并但无测试」的情况（`gh issue list` / `gh pr list` 逐一比对）。
- Issue #11「Dependency Map」保持 OPEN，`docs/backlog.yml` 中无对应 Story，属非 Story 的依赖关系参考条目，不是漏关闭。
- PR #20（`temp/s8-fail`）按设计关闭未合并、PR #21（`temp/s8-pass`）按设计合入 `main`，两者均为 S8 AC2 的行为验证产物，不是漏合并。

## 3. 功能完成度

| Story | 标题 | Issue | PR | 测试证据 | 状态 |
|-------|------|-------|----|----------|------|
| S1 | 校验零依赖项目骨架并补齐 Node 版本与使用说明 | [#1](https://github.com/tomagoyaky/macos-hello/issues/1)（CLOSED 2026-10-30T07:07:13Z） | [#12](https://github.com/tomagoyaky/macos-hello/pull/12)（MERGED 2026-10-30T07:07:12Z） | `story-S1-gate.json` check4：`pnpm test` 7 tests / 7 pass / 0 fail，EXIT=0；`test/project.test.js` 断言四类依赖字段为空与 `package.json` 契约 | 已完成 |
| S2 | 实现默认问候入口 | [#2](https://github.com/tomagoyaky/macos-hello/issues/2)（CLOSED 2026-10-30T07:15:16Z） | [#13](https://github.com/tomagoyaky/macos-hello/pull/13)（MERGED 2026-10-30T07:15:14Z） | `story-S2-gate.json` check4：13/13 pass，EXIT=0；AC1 用 `od -c` / `od -An -tx1` 字节比对 `Hello, World!\n`，AC2 用 `cmp` 证明两次输出逐字节一致 | 已完成 |
| S3 | 实现 `--name` 正常取值问候 | [#3](https://github.com/tomagoyaky/macos-hello/issues/3)（CLOSED 2026-10-30T07:23:21Z） | [#14](https://github.com/tomagoyaky/macos-hello/pull/14)（MERGED 2026-10-30T07:23:20Z） | `story-S3-gate.json` check4：18/18 pass、skipped 0，EXIT=0；四条 AC 逐条 `spawnSync` 实测（含 `Wu Ming`、`--name=Alice` 字节一致、256 字符原样输出） | 已完成 |
| S4 | 非法用法返回 Usage 提示并以退出码 1 结束 | [#4](https://github.com/tomagoyaky/macos-hello/issues/4)（CLOSED 2026-10-30T07:30:43Z） | [#15](https://github.com/tomagoyaky/macos-hello/pull/15)（MERGED 2026-10-30T07:30:41Z） | `story-S4-gate.json` check4：26/26 pass、skipped 0，EXIT=0；`--name`、`--name ""`、`--foo`、`--help`、`-h`、`extra`、`--name -x` 逐项实测 exit=1 且 stderr 为 `Usage: hello [--name <name>]` | 已完成 |
| S5 | 编写核心函数单元测试 | [#5](https://github.com/tomagoyaky/macos-hello/issues/5)（CLOSED 2026-10-30T07:39:53Z） | [#16](https://github.com/tomagoyaky/macos-hello/pull/16)（MERGED 2026-10-30T07:39:51Z） | `story-S5-gate.json` check4：39 tests / 39 pass / 0 fail，exit=0；`test/greet.test.js` 覆盖 UT-01~UT-14 共 14 条并直接 `import src/greet.js` | 已完成 |
| S6 | 编写 CLI 黑盒验收测试 | [#6](https://github.com/tomagoyaky/macos-hello/issues/6)（CLOSED 2026-10-30T07:50:05Z） | [#17](https://github.com/tomagoyaky/macos-hello/pull/17)（MERGED 2026-10-30T07:50:03Z） | `story-S6-gate.json` check4：40 tests / 40 pass / 0 fail，exit=0；`test/cli.test.js` 以 `spawnSync` 运行真实进程，覆盖 E2E-01~E2E-12 | 已完成 |
| S7 | 建立 GitHub Actions 测试工作流 | [#7](https://github.com/tomagoyaky/macos-hello/issues/7)（CLOSED 2026-10-30T08:01:25Z） | [#18](https://github.com/tomagoyaky/macos-hello/pull/18)（MERGED 2026-10-30T08:01:23Z） | `story-S7-gate.json` check4：本地 `pnpm test` 47/47 pass，exit=0；CI run 41023133861（push）与 41023157884（pull_request）均 success，test job 日志含 `runtime dependencies: 0`；`test/workflow.test.js` 断言工作流契约 | 已完成 |
| S8 | 配置主分支合并前状态检查 | [#8](https://github.com/tomagoyaky/macos-hello/issues/8)（CLOSED 2026-10-30T09:14:19Z） | [#19](https://github.com/tomagoyaky/macos-hello/pull/19)（MERGED 2026-10-30T09:14:07Z） | `story-S8-gate.json` check9：PR #20 `test` FAILURE / `mergeStateStatus=BLOCKED` 且关闭未合并，PR #21 `test` SUCCESS 后合并成功（S8 AC2 行为验证）；`test/ruleset.test.js` 4 条；线上 ruleset `26192346`（`main-protection`）`enforcement=active`，必需检查 `test`。注意：CI 中无 `GH_TOKEN` 时这 4 条会降级为 SKIP | 已完成 |
| S9 | 演练测试拦截回归 | [#9](https://github.com/tomagoyaky/macos-hello/issues/9)（CLOSED 2026-10-30T09:14:14Z） | [#22](https://github.com/tomagoyaky/macos-hello/pull/22)（MERGED 2026-10-30T09:14:13Z） | `docs/drill/S9-test-interception.json` + `story-S9-gate.json` check9~11：变异后本地重放 47 tests / 35 pass / 12 fail、`DRILL_EXIT=1`；CI run 41030609277 的 test job failure，12 条 `not ok` 行与记录逐字一致；还原后基线 run 41023684797 success，临时分支已删除 | 已完成 |
| S10 | 端到端验收复跑并核对成功指标 | [#10](https://github.com/tomagoyaky/macos-hello/issues/10)（CLOSED 2026-10-30T09:43:24Z） | [#23](https://github.com/tomagoyaky/macos-hello/pull/23)（MERGED 2026-10-30T09:43:22Z） | `docs/acceptance/S10-acceptance.json`：Node v20.20.2 全新克隆 `459e90b`，`pnpm install --frozen-lockfile` exit=0，SC1~SC4 通过，本地 65/65/0 与 CI run 41034420760 一致，M1~M5 逐项记录；`story-S10-gate.json` check9~12 独立重放通过 | 已完成 |

## 4. 成功指标判定

对照 `docs/PRD.md` 第 5 节五项指标。判定口径：有可复核证据且满足目标值记为「满足」；证据方向正确但样本或范围与目标值不完全对齐记为「部分满足」；无证据或违反目标值记为「未满足」。

| 指标 | 目标值 | 判定 | 证据 |
|------|--------|------|------|
| hello 命令可运行 | `node bin/hello.js` 标准输出为 `Hello, World!`，退出码 0，连续 3 次结果一致 | 满足 | 实跑 `od -c` 输出 `H e l l o ,   W o r l d ! \n`（16 字节）、exit=0；`docs/acceptance/S10-acceptance.json` SC1 记录 Node v20.20.2 全新克隆 `runs=3` 结果一致；CI run [41041476005](https://github.com/tomagoyaky/macos-hello/actions/runs/41041476005) 的 test job 覆盖 E2E-01 等用例且 success |
| `--name` 参数可用 | `node bin/hello.js --name Alice` 输出 `Hello, Alice!`，退出码 0 | 满足 | 实跑 `--name Alice` 与 `--name=Alice` 均输出 `Hello, Alice!`；S10 验收 SC2 记录 stdout `Hello, Alice!\n`、stderr 空、exit 0；`test/cli.test.js` E2E-03 以 `strictEqual` 断言整串，E2E-06~E2E-10 覆盖含空格值与 `--name=` 内联形式；CI run 41041476005 中 90/90 通过 |
| 测试通过率 | 100%，失败用例数为 0，三类场景每类至少 1 条用例 | 满足 | 本次复核 `pnpm test` 输出 `tests 90 / pass 90 / fail 0`、EXIT=0（Node v25.6.1）；`docs/test-report.md` 记录 Node 20.20.2 下 90/90、fail 0、EXIT=0；CI run 41041476005 test job 日志同为 `# tests 90 / # pass 90 / # fail 0`；S10 验收给出三类场景覆盖数 defaultOutput=6 / nameValue=7 / nameMissingValue=4；用例名含 E2E-01 / E2E-03 / E2E-05 |
| CI 成功率 | 主分支最近 10 次推送的 CI 运行成功率达到 100% | 部分满足 | `main` 分支 push 运行仅 2 次：[41026526005](https://github.com/tomagoyaky/macos-hello/actions/runs/41026526005)（2026-10-30T08:27:11Z）与 [41023836794](https://github.com/tomagoyaky/macos-hello/actions/runs/41023836794)（08:02:52Z），均 success，2/2=100%，但样本不足目标要求的最近 10 次。若按默认分支 `develop` 统计，最近 10 次 push 为 9 success + 1 failure（run [41033906893](https://github.com/tomagoyaky/macos-hello/actions/runs/41033906893)，2026-10-30T09:30:18Z，commit `886c023`，test job failure），成功率 90%，未达 100%。该次失败原因是 `pnpm test -- --test-reporter=spec` 的参数被当作文件路径（日志 `Could not find '.../--test-reporter=spec'`），属流水线步骤写法问题，不是测试断言失败；后续提交改为直接调用 `node --test` 后运行成功（run 41034064463） |
| 运行时第三方依赖数 | 保持 0 | 满足 | `package.json` 的 `dependencies` / `devDependencies` / `optionalDependencies` / `peerDependencies` 均未声明；CI run 41041476005 的 `Assert zero runtime dependencies` 步骤输出 `runtime dependencies: 0`；`test/project.test.js` 断言 `pnpm list --prod --depth 0` 为 0；S10 验收 M5 记录 `pnpm list --prod --depth 0 --json => []` |

汇总：五项指标中 4 项满足、1 项（CI 成功率）部分满足，不存在「未满足」项，但 CI 成功率尚不能按 PRD 原文口径判为达标。

## 5. 测试与 CI 证据

### 5.1 本地测试

| 来源 | 环境 | 结果 |
|------|------|------|
| 本次交付文档复核（2026-10-30） | Node v25.6.1、pnpm 10.28.2 | `pnpm test`：`tests 90 / pass 90 / fail 0 / skipped 0`，EXIT=0。注意：本机 Node 为 25.x，满足 `engines.node >= 20` 但不是 CLAUDE.md 要求的 20.x，仅作参考 |
| `docs/test-report.md`（2026-10-30T10:05:41Z） | Node 20.20.2、pnpm 10.28.2，分支 `test/phase-4` HEAD `75dff22` | `pnpm test`：90/90、fail 0、skipped 0，EXIT=0；`pnpm run lint` EXIT=0；`pnpm coverage` EXIT=0；生产代码 `bin/hello.js` + `src/greet.js` 行覆盖 100%，全仓库行覆盖 98.51% |
| `docs/acceptance/S10-acceptance.json`（2026-10-30T09:36:00Z） | Node v20.20.2，全新克隆 `chore/S10` HEAD `459e90b` | `pnpm test` 65/65、fail 0，与 CI run [41034420760](https://github.com/tomagoyaky/macos-hello/actions/runs/41034420760)（其 `headSha` 同为 `459e90b`，conclusion=success）一致 |

数字差异说明：S10 验收时的 65 条用例对应提交 `459e90b`；`test-report.md` 的 90 条对应 `75dff22`（Phase 4 新增验收测试后）；当前 `develop` HEAD `23da245` 的 CI 实测为 90 条。三份记录各自对应不同提交，不构成互相矛盾，但两份文档均未标注提交差异，见风险 R5。

### 5.2 CI 结果

- 当前基线运行：[CI run 41041476005](https://github.com/tomagoyaky/macos-hello/actions/runs/41041476005)，事件 `push`，分支 `develop`，HEAD `23da245`，conclusion=`success`。
- 四个 job 全部 success：`lint`、`test`、`build`、`deploy-staging`（`gh run view 41041476005 --json jobs`）。
- `test` job 关键日志：`# tests 90`、`# pass 90`、`# fail 0`；步骤 `Assert zero runtime dependencies` 输出 `runtime dependencies: 0`。
- 构建产物上传成功：artifact `test-report`，4304 bytes，未过期（`gh api .../runs/41041476005/artifacts`）。
- 工作流定义：`.github/workflows/ci.yml`，`name: CI`，触发条件为 `push` / `pull_request` 且目标分支仅 `develop`；权限 `contents: read`；`pnpm/action-setup@v4` 固定 pnpm 10.28.2；所有 job `runs-on: ubuntu-latest`、`timeout-minutes: 10`、Node `20.x`。
- 历史运行：S7 阶段 CI run 41023133861（push）与 41023157884（pull_request）均 success；S9 演练 run 41030609277 的 test job failure 且 12 条 `not ok` 行与 `docs/drill/S9-test-interception.json` 一致，还原后基线 run 41023684797 success。

### 5.3 测试拦截演练（S9）

- 变异内容：把问候模板改为缺少感叹号；本地重放 47 tests / 35 pass / 12 fail、`DRILL_EXIT=1`。
- CI 侧：run 41030609277 的 test job failure，失败用例名可在日志中定位。
- 还原后：基线 run 41023684797 success；临时分支已删除，演练提交未合入主干。
- 结论：测试具备拦截回归的能力（证据：`docs/drill/S9-test-interception.json`、`story-S9-gate.json` check9~11）。

### 5.4 部署

- `deploy-staging` 为占位实现：日志明确输出 `No staging deploy target is configured; running the placeholder deploy. Deployment not verified.` 与 `Would deploy tomagoyaky/macos-hello@23da245... to environment staging.`，随后执行 runner 内冒烟检查并输出 `smoke checks passed`（CI run 41041476005 日志）。
- 仓库 Actions secrets 仅 `STAGING_DEPLOY_KEY`，environments 仅 `staging`（`gh api .../actions/secrets`、`.../environments`）；`deploy-staging` 首步只校验该 secret 非空。
- **部署未验证**：没有真实 staging 主机、没有产物分发与启动步骤，job 绿灯只证明占位流水线可执行，不代表已发布。文档依据：`docs/deployment-runbook.md` 首段与「部署步骤」第 6 步。

### 5.5 未验证事项

| 事项 | 状态 | 原因 |
|------|------|------|
| Playwright 浏览器 E2E | 未验证（skipped） | 纯 CLI 项目无 Web 面，仓库无 Playwright 依赖与 `e2e/` 目录；等价的真实进程黑盒用例由 `test/cli.test.js` 承接（`docs/test-report.md`） |
| 真实预发部署 | 未验证 | 无 staging 目标，`deploy-staging` 为占位（`docs/deployment-runbook.md`） |
| CI 中 S8 线上 ruleset 校验 | 未在 CI 实际执行（SKIP） | 未配置 `GH_TOKEN` secret，4 条用例降级为带原因的 SKIP；线上 ruleset 已通过 `gh api` 人工复核（`enforcement=active`、必需检查 `test`） |
| 仓库私有可见性 | 已验证为 PUBLIC（与 PRD 冲突） | PRD 第 1 节要求私有仓库，`gh repo view` 实测 `visibility=PUBLIC`，未见 PRD 变更或例外批准记录，见风险 R1 |

## 6. 剩余风险

| 编号 | 风险 | 影响 | 建议动作 | 证据 |
|------|------|------|----------|------|
| R1 | 仓库可见性与 PRD 约束冲突：PRD 要求「GitHub 私有仓库，不对外发布」，实际为 public | 违反 PRD 第 1 节约束；代码与提交历史对外可见；若转回 private，`main` 保护可能因 GitHub Free 限制失效 | 由仓库所有者决策：要么转回 private 并重新确认 ruleset 可用性，要么在 PRD/运行手册中登记例外与理由 | `gh repo view` 输出 `visibility: PUBLIC`；`docs/PRD.md` 第 1 节；`docs/workflow-runbook.md` 第 6 节 |
| R2 | CI 成功率指标证据不足：main 仅 2 次 push 运行；develop 最近 10 次为 9 success + 1 failure（失败为 spec reporter 参数写法问题，已修复） | 无法按 PRD 原文（最近 10 次、100%）判定达标，验收口径存在争议 | 明确指标统计分支与样本下限并回写 PRD；在修复后的代码基线上累积 10 次 push 运行并复测成功率 | `gh run list --branch main` / `--branch develop`；`gh run view 41033906893 --log-failed`；`docs/acceptance/S10-acceptance.json` M4 |
| R3 | 部署链路未验证：`deploy-staging` 为占位，无真实目标 | 无预发发布与发布后验证能力，绿色流水线可能被误读为已上线 | 提供 staging 主机与部署凭据，替换占位步骤；完成首次带真实目标的部署演练后移除「部署未验证」标注 | `docs/deployment-runbook.md`；CI run 41041476005 deploy-staging 日志 |
| R4 | `docs/test-report.md` 状态过期：文中称 PR #24 OPEN、`test/phase-4` HEAD `75dff22` 为当前状态 | 读者可能误判 Phase 4 尚未合并，或误用旧提交号 | 更新报告状态为「PR #24 已合并于 2026-10-30T10:08:50Z」，并注明当前 `develop` HEAD 为 `23da245` | `gh pr list` 显示 PR #24 MERGED；`docs/test-report.md` 第 6 行与结论段 |
| R5 | 测试数字 65 与 90 并存且未交叉说明 | 两份「最终证据」看似矛盾，审计时需额外排查 | 在两份文档中标注各自对应提交（65→`459e90b`，90→`75dff22`）与测量时间 | `docs/acceptance/S10-acceptance.json`；`docs/test-report.md` |
| R6 | S8 线上 ruleset 检查在 CI 中降级为 SKIP（无 `GH_TOKEN`） | `main` 分支保护不会被 CI 自动校验，配置漂移无法被发现 | 配置具备仓库 administration 读权限的 `GH_TOKEN` repository secret，并确认 4 条用例在 CI 中实跑 | `docs/test-report.md`「未覆盖风险」第 2 条；`gh api .../actions/secrets` 仅 `STAGING_DEPLOY_KEY` |
| R7 | 部分测试依赖 GitHub 实时 API：S10 关卡记录裸 `pnpm test`（无 `GH_TOKEN`）时 7 条用例因 403 rate limit 失败 | 断网、令牌失效或限流时本地测试可能变红，影响可复现性 | 统一本地/CI 注入令牌，或将实时检查与核心套件分离为可选任务 | `story-S10-gate.json` check4 证据；`docs/test-report.md` 离线降级复核 |
| R8 | 覆盖率与静态检查门禁范围偏窄：覆盖率阈值只统计 `src/`；`lint`/`build` 只 `node --check bin/hello.js`（CI 另有全量语法检查） | `bin/hello.js` 行覆盖跌破 80% 不会被拦截；本地脚本无法发现其他文件语法错误 | 把 `bin/` 纳入覆盖率阈值；将全量 `node --check` 落到 `package.json` 脚本 | `docs/test-report.md` 覆盖率与残留风险第 3、6 条；`package.json` scripts |
| R9 | 契约冲突 D1 与 D8 未收口：名称含换行时输出两行，违反 TRD D1「成功路径 stdout 恰为一行」 | 验收口径不一致，可能引发后续需求分歧 | 由产品/设计负责人裁定：禁止换行（返回 Usage）或修订 D1 并保留 E2E-15 | `docs/test-report.md` 残留风险第 4 条；`test/cli.test.js` E2E-15 |
| R10 | Node.js 20 已过上游维护期（2026-04 结束） | 安全补丁缺失，CI 运行时逐渐过时 | 规划升级到受支持的 LTS，并同步修改 `engines.node`、`.nvmrc`、CI `node-version`、README 与部署手册后全量回归 | `docs/deployment-runbook.md` 故障处理表末行 |
| R11 | 交付文档尚未纳入版本控制：`git status` 显示 `docs/.workflow/`、`docs/workflow-runbook.md` 未跟踪；本次 `docs/delivery-summary.md` 与 `README.md` 改动也未提交 | 交付物只存在于工作区，克隆仓库看不到阶段证据与交付总结 | 按 Gitflow 提交（`docs(phase-6): ...`），或明确将 `docs/.workflow/` 排除并同步运行手册说明 | `git status --short` 输出 |
| R12 | 仅 `main` 有分支保护，`develop` 无保护（ruleset 条件 `include: refs/heads/main`） | 直接 push `develop` 可绕过 PR 与检查，进而触发占位部署 | 为 `develop` 增加 ruleset（至少要求 `test`），或明确单人维护下的例外 | `gh api repos/.../rulesets/26192346` 的 `conditions.ref_name.include`；`docs/deployment-runbook.md` 前置条件表 |
| R13 | Issue #11「Dependency Map」长期 OPEN | 无功能影响，但看板存在「未关闭项」噪声 | 在 Issue 中标注「参考条目，不随交付关闭」或转为 Wiki/文档 | `gh issue list --state all`；`docs/workflow-runbook.md` 第 6 节 |

## 7. 后续建议

按优先级排列，均以「可复核动作」描述。

**P0：交付前必须处理**

1. 提交交付文档：把 `README.md`、`docs/delivery-summary.md`、`docs/workflow-runbook.md` 与 `docs/.workflow/` 按 Gitflow 提交并推送到 `develop`，形成可追溯的交付快照（对应 R11）。
2. 决定仓库可见性：由仓库所有者确认恢复 private 或正式修订 PRD 约束，二者择一留痕（对应 R1）。
3. 重新定义并复测 CI 成功率口径：失败 run 41033906893 的根因是 spec reporter 参数传递写法（已由后续提交改为直接调用 `node --test`），需按明确的统计分支与样本下限在新的绿色基线上累积 10 次运行后复测（对应 R2）。

**P1：交付后一周内**

4. 接入真实 staging 目标，替换 `deploy-staging` 占位步骤，完成一次带目标主机的部署与冒烟演练，并从手册与本文档移除「部署未验证」（对应 R3）。
5. 配置 `GH_TOKEN` repository secret，使 4 条 ruleset 线上检查在 CI 中真实执行（对应 R6）。
6. 刷新 `docs/test-report.md`：更新 PR #24 合并状态、当前 HEAD 与测试数字，并标注 65/90 的提交来源（对应 R4、R5）。
7. 统一本地测试对 GitHub 实时 API 的依赖策略：注入令牌或拆分可选任务，避免无令牌时出现 7 条失败（对应 R7）。

**P2：持续改进**

8. 扩展门禁：把 `bin/` 纳入覆盖率阈值，把全量语法检查写入 `package.json` 脚本（对应 R8）。
9. 收口 D1/D8 契约冲突，形成对「名称含换行」的明确产品决策并补对应回归用例（对应 R9）。
10. 规划 Node.js 升级：选择当前受支持的 LTS，同步更新 `engines.node`、`.nvmrc`、CI、README 与部署手册后全量回归（对应 R10）。
11. 为 `develop` 增加至少要求 `test` 状态的 ruleset，或登记单人维护的例外说明（对应 R12）。
12. 清理看板：对 Issue #11 标注归属或归档；为中文/emoji 名称、`--name=` 空值等边界补充回归用例（对应 R13、`docs/test-report.md` 残留风险第 5 条）。

**交付结论**

- 功能：10/10 Story 完成，10 条 Story 对应的 Issue 全部关闭、PR 全部合并，核心路径（默认问候、`--name`、非法用法）均经真实进程黑盒测试与人工复核。
- 质量：测试 90/90、fail 0；生产代码行/函数覆盖 100%；S9 演练证明测试可拦截回归；CI 四 job 在 `develop` HEAD 全绿。
- 未达项：CI 成功率仅「部分满足」（样本不足且 develop 存在 1 次失败）；部署未验证；仓库可见性与 PRD 冲突。
- 综上：**功能交付完成，不建议按「全部指标达标」结项**；完成 P0 事项后可按 PRD 第 5 节全量复测并重新判定。