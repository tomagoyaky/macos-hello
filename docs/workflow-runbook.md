# 交付工作流运行手册

本文件记录 macos-hello 本次端到端交付实际使用的 7 阶段工作流、执行命令、质量关卡与产物位置。编排脚本位于工作流仓库的 `workflows/` 目录（不属于本仓库），本仓库保存需求、设计、测试、CI 与阶段状态等交付产物。

## 1. 阶段总览

阶段严格串行；任一阶段关卡未通过即停止，不自动进入下一阶段。

| Phase | 目标 | 状态 | 关键产物 |
|-------|------|------|----------|
| 0 环境预检 | 校验仓库、身份、权限、工具链与网络 | 通过 | `docs/.workflow/phase-0.json` |
| 1 立项与需求 | 生成 PRD、TRD、Story backlog | 通过 | `docs/PRD.md`、`docs/TRD.md`、`docs/backlog.yml` |
| 2 环境初始化 | 创建标签、里程碑、Issue 与项目规范 | 通过 | `CLAUDE.md`、GitHub Issue #1-#11 |
| 3 Gitflow 开发 | 按 Story 执行红-绿-重构并合并 PR | 通过（10/10） | 各 Story 的 `docs/.workflow/story-*-gate.json`、PR #12-#23 |
| 4 测试 | 覆盖率审计、补充测试、测试报告 | 通过 | `docs/test-report.md`、PR #24 |
| 5 CI/CD | GitHub Actions 流水线与部署运行手册 | 通过 | `.github/workflows/ci.yml`、`docs/deployment-runbook.md`、[CI run 41041046753](https://github.com/tomagoyaky/macos-hello/actions/runs/41041046753) |
| 6 交付 | 一致性核对、交付总结、README | 通过（7/7） | `docs/delivery-summary.md`、`README.md` |

## 2. 执行方式

每个阶段是一个 Claude Code Workflow 脚本，使用同一份参数对象（示例见工作流仓库的 `docs/workflow-args.example.json`）：

```js
Workflow({
  scriptPath: '<workflow-root>/workflows/03-development.js',
  args: {
    workflowRoot: '<workflow-root>',
    project: {
      name: 'macos-hello',
      root: '/absolute/path/to/macos-hello',
      repo: 'tomagoyaky/macos-hello',
      baseBranch: 'develop',
      packageManager: 'pnpm',
      stack: 'Node.js 20 + JavaScript CLI',
    },
    options: { dryRun: false, maxStories: 4, autoInstall: true, allowBasePush: true },
  },
});
```

约束：

- 阶段按 0 → 1 → 2 → 3 → 4 → 5 → 6 顺序执行；关卡失败时暂停并按 `next_action` 修复后重跑。
- Phase 3 每次最多推进 4 条 Story；本次共 10 条串行 Story，分多次运行直至 10/10。
- Phase 5 需要 `options.allowBasePush=true` 才会推送分支并等待 GitHub Actions。
- 所有阶段只写目标项目内的业务产物与 `docs/.workflow/` 遥测文件。

## 3. 状态与遥测

| 文件 | 用途 |
|------|------|
| `docs/.workflow/state.json` | 各阶段最终状态（`{ phases: PhaseResult[] }`），是阶段状态的唯一事实来源 |
| `docs/.workflow/phase-N.json` | 单个阶段的完整结果：工具、命令、产物、关卡、风险、下一步 |
| `docs/.workflow/story-<id>-gate.json` | Phase 3 每条 Story 的关卡结果 |
| `docs/.workflow/events/current.json` | 当前 run 的 `run_id` |
| `docs/.workflow/events/<run_id>.jsonl` | 子代理级事件日志，供可视化系统实时读取 |

事件字段与写入规则见工作流仓库的 `docs/workflow-events.md`。事件写入失败不阻塞交付。

## 4. 校验命令

```bash
# 本地质量门禁
pnpm lint
pnpm build
pnpm test

# 覆盖率（本地参考，非 CI 门禁）
pnpm coverage

# 最近一次 CI 运行
gh run list --repo tomagoyaky/macos-hello --branch develop --limit 5

# 阶段状态
jq '.phases[] | {phase, status}' docs/.workflow/state.json
```

## 5. 关卡规则

- 关卡结果只有 `pass` / `fail` / `blocked`；`status` 与 `gate.result` 必须一致。
- 写 `pass` 必须有可复核证据：命令输出、测试数字、CI 运行 URL、文件路径。
- 被跳过或降级的能力必须写明，不得把“未验证”写成“已完成”。
- Phase 5 的 `deploy-staging` 当前是占位部署：job 绿灯只证明流水线可执行，不代表已发布到真实预发环境。

## 6. 已知限制与剩余风险

- `deploy-staging` 未接入真实预发目标，`STAGING_DEPLOY_KEY` 为占位值，部署未验证。
- 仓库当前为 public，以启用 GitHub ruleset；如恢复 private，`main` 分支保护会失效（GitHub Free 限制）。
- Issue #11 `Dependency Map` 是非 Story 的参考条目，保持打开用于追溯 Story 依赖关系。
- CI 中四条线上 ruleset 检查在缺少 `GH_TOKEN` secret 时会跳过；本地有 `gh` 登录时会实际执行。