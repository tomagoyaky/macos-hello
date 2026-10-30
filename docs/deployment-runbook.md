# macos-hello 部署运行手册

> **状态：部署未验证。** 当前仓库没有真实部署目标（无 Dockerfile、无 Vercel/Netlify/Fly/K8s 配置），`ci.yml` 中的 `deploy-staging` 执行的是占位命令，只校验密钥存在并做本机冒烟检查。在接入真实 staging 主机并完成首次人工验证之前，任何 "deploy-staging 成功" 都不代表应用已经发布。
>
> 工作流名称：`ci`；基线分支：`develop`；自动部署只在 push 到 `develop` 时触发。

## 前置条件

| 项目 | 要求 |
|------|------|
| 代码仓库 | `git@github.com:tomagoyaky/macos-hello.git`，基线分支 `develop` |
| 运行平台 | 产品目标平台为 macOS；CI runner 为 `ubuntu-latest`，仅用于持续集成与本机冒烟 |
| Node.js | CI 固定 `22.x`；`package.json` 的 `engines.node` 为 `>=20`；本地 `.nvmrc` 为 `20`（见故障处理中的版本差异） |
| pnpm | `10.28.2`，与 `package.json` 的 `packageManager` 一致，推荐用 `corepack enable` 启用 |
| 依赖 | 零运行时依赖、零开发依赖；`pnpm install --frozen-lockfile` 实质为 no-op |
| 数据库/迁移 | 无数据库、无迁移脚本、无 feature flag 系统 |
| GitHub 权限 | 仓库 write、Actions 读、Environment secrets 管理 |
| GitHub Environment | 已创建名为 `staging` 的环境，并已配置环境密钥 `STAGING_DEPLOY_KEY` |
| 本地工具 | `git`、`node`、`pnpm`、可选 `gh` CLI |
| 部署产物 | 测试报告 artifact：`test-report`（内容为 `test-results/test.log`，保留 7 天） |

建议为 `staging` 环境配置保护规则（required reviewers 或等待计时器）；当前仓库未强制。

## 环境变量与 Secrets

| 名称 | 用途 | 配置位置 | 是否必需 |
|------|------|----------|----------|
| `STAGING_DEPLOY_KEY` | staging 部署凭据。当前仅做非空校验，占位部署不会使用其值，也不会输出到日志 | GitHub 仓库 Settings → Environments → `staging` → Environment secrets（不是 Repository secrets） | 是。为空时 `deploy-staging` 第一步直接 `::error::` 并退出 1 |
| `GITHUB_TOKEN` | Actions 自动生成的令牌；工作流仅声明 `permissions: contents: read`，未显式注入测试步骤 | GitHub Actions 内置 | 自动，无需配置 |
| `GITHUB_REPOSITORY` | 内置的 `owner/repo` 标识，用于占位部署输出 | GitHub Actions 内置 | 自动 |
| `GITHUB_SHA` | 内置的触发提交 SHA，用于标识部署版本 | GitHub Actions 内置 | 自动 |
| `GITHUB_REF_NAME` | 内置的触发分支名 | GitHub Actions 内置 | 自动 |
| `GH_TOKEN` / `GITHUB_API_URL` | 仅在本地运行 live GitHub 断言时需要；CI 不设置，相关用例会自动 skip | 本地 shell / `gh` CLI | 否 |
| 应用环境变量 | 项目不读取任何业务环境变量 | 无 | 无 |

注意：把 `STAGING_DEPLOY_KEY` 配成 **Repository secrets** 时，`environment: staging` 的作业仍能读取到同名 secret，但无法享受环境级隔离；推荐放在 Environment secrets。

## 部署步骤

### 方式一：CI 自动部署（push 到 develop）

1. 在功能分支完成修改，提交并推送：

   ```bash
   git switch develop
   git pull --ff-only
   git switch -c feature/<desc>
   git add <files>
   git commit -m "feat(scope): <description>"
   git push -u origin feature/<desc>
   ```

2. 创建并合并 PR 到 `develop`：

   ```bash
   gh pr create --repo tomagoyaky/macos-hello --base develop --head feature/<desc> --title "<title>" --body "<body>"
   gh pr checks --repo tomagoyaky/macos-hello --watch
   gh pr merge --repo tomagoyaky/macos-hello --merge <pr-number> --delete-branch
   ```

   PR 事件只运行 `lint`、`test`、`build`；`deploy-staging` 因 `if` 条件被跳过，这是预期行为。

3. 合并产生 push 到 `develop`，工作流 `ci` 依次执行：

   - `lint`：`pnpm install --frozen-lockfile` → `pnpm lint`
   - `test`：`pnpm install --frozen-lockfile` → `pnpm test` → 零运行时依赖断言 → 上传 `test-report`
   - `build`：`pnpm install --frozen-lockfile` → `pnpm build`
   - `deploy-staging`：仅 `push` 且分支为 `develop` 时运行，挂载 `staging` 环境

   查看运行状态：

   ```bash
   gh run list --repo tomagoyaky/macos-hello --workflow ci.yml --limit 5
   gh run watch --repo tomagoyaky/macos-hello <run-id>
   ```

4. `deploy-staging` 内部实际执行的命令如下（当前为占位实现）：

   ```bash
   # Step 1: fail fast when the environment secret is missing
   if [ -z "${STAGING_DEPLOY_KEY}" ]; then
     echo "::error::STAGING_DEPLOY_KEY is empty. Configure it in Settings > Environments > staging > Environment secrets."
     exit 1
   fi

   # Step 2: placeholder deployment (deployment not verified)
   echo "::warning::No staging deploy target is configured; running the placeholder deploy. Deployment not verified."
   echo "Would deploy ${GITHUB_REPOSITORY}@${GITHUB_SHA} from ${GITHUB_REF_NAME} to environment staging."

   # Step 3: local smoke checks on the runner
   test "$(node bin/hello.js)" = "Hello, World!"
   test "$(node bin/hello.js --name Alice)" = "Hello, Alice!"
   echo "smoke checks passed"
   ```

   **部署未验证**：第 2 步不是真实发布，接入真实目标前不得据此报告上线成功。

### 方式二：手工执行部署前校验（当前可执行）

在没有真实 staging 主机时，用以下命令在本地复现 CI 的全部校验步骤：

```bash
git clone git@github.com:tomagoyaky/macos-hello.git
cd macos-hello
git switch develop
corepack enable
pnpm install --frozen-lockfile
pnpm lint
pnpm build
node bin/hello.js
```

预期：安装输出 `Already up to date` 并以 0 退出，`pnpm lint` 与 `pnpm build` 均退出 0，最后一行输出 `Hello, World!`。

运行完整测试（当前有已知失败，见"故障处理"）：

```bash
pnpm test
```

### 接入真实 staging 目标后的替换模板（尚未验证，请勿直接用于生产）

拿到 staging 主机、用户和密钥后，把 `deploy-staging` 的占位步骤替换为类似命令，并在首次执行后回填本文档：

```bash
# Package the exact commit
git archive --format=tar.gz --prefix=macos-hello/ -o "dist/macos-hello-${GITHUB_SHA}.tar.gz" HEAD

# Upload and switch the release symlink
scp -i <deploy-key-path> "dist/macos-hello-${GITHUB_SHA}.tar.gz" <user>@<staging-host>:/opt/macos-hello/releases/
ssh -i <deploy-key-path> <user>@<staging-host> "tar -xzf /opt/macos-hello/releases/macos-hello-${GITHUB_SHA}.tar.gz -C /opt/macos-hello/releases && ln -sfn /opt/macos-hello/releases/macos-hello-${GITHUB_SHA} /opt/macos-hello/current"

# Smoke check the deployed release
ssh -i <deploy-key-path> <user>@<staging-host> "/opt/macos-hello/current/bin/hello.js"
```

## 冒烟检查

每一项都可直接执行，按表格中的预期结果判定。

| 检查项 | 命令 | 预期结果 |
|--------|------|----------|
| 默认问候 | `node bin/hello.js` | stdout 为 `Hello, World!`，退出码 0 |
| 具名问候（空格） | `node bin/hello.js --name Alice` | stdout 为 `Hello, Alice!`，退出码 0 |
| 具名问候（等号） | `node bin/hello.js --name=Alice` | stdout 为 `Hello, Alice!`，退出码 0 |
| 非法参数 | `node bin/hello.js --bogus` | 退出码 1，stderr 为 `Usage: hello [--name <name>]` |
| 空名称 | `node bin/hello.js --name ''` | 退出码 1，stderr 为 `Usage: hello [--name <name>]` |
| 语法检查 | `pnpm lint` | 退出码 0，无报错（仅打印 pnpm 脚本横幅） |
| 构建检查 | `pnpm build` | 退出码 0，无报错（仅打印 pnpm 脚本横幅） |
| 测试套件 | `pnpm test` | 目标：90 个用例全部通过。当前已知 7 个 S7 用例失败（见故障处理），修复测试后恢复 |
| CI 测试报告 | 在 Actions 运行页下载 artifact `test-report` | 包含 `test.log`，内容与 `pnpm test` 输出一致 |
| CI 部署冒烟 | `deploy-staging` 的 `Smoke check` 步骤 | 日志末行为 `smoke checks passed` |

可一次性执行的冒烟脚本（已本地验证）：

```bash
set -euo pipefail
test "$(node bin/hello.js)" = "Hello, World!"
test "$(node bin/hello.js --name Alice)" = "Hello, Alice!"
test "$(node bin/hello.js --name=Alice)" = "Hello, Alice!"
if node bin/hello.js --bogus >/dev/null 2>&1; then
  echo "expected exit code 1 for invalid arguments" >&2
  exit 1
fi
node bin/hello.js --bogus 2>&1 | grep -qx "Usage: hello [--name <name>]"
pnpm lint
pnpm build
echo "smoke checks passed"
```

## 回滚步骤

### 方式一：重新部署上一个版本（不改代码）

适用于新版本已在 staging 出错、需要立即恢复旧版本的情况。

1. 找到上一个稳定提交：

   ```bash
   git fetch origin develop
   git log --oneline -10 origin/develop
   ```

2. 按"接入真实 staging 目标后的替换模板"重新打包并部署 `<previous-sha>`，把软链接指回旧版本目录：

   ```bash
   git archive --format=tar.gz --prefix=macos-hello/ -o "dist/macos-hello-<previous-sha>.tar.gz" <previous-sha>
   scp -i <deploy-key-path> "dist/macos-hello-<previous-sha>.tar.gz" <user>@<staging-host>:/opt/macos-hello/releases/
   ssh -i <deploy-key-path> <user>@<staging-host> "tar -xzf /opt/macos-hello/releases/macos-hello-<previous-sha>.tar.gz -C /opt/macos-hello/releases && ln -sfn /opt/macos-hello/releases/macos-hello-<previous-sha> /opt/macos-hello/current"
   ```

3. 按"冒烟检查"逐项验证。当前 `deploy-staging` 是占位实现，此方式的实际执行部分**部署未验证**。

### 方式二：回退 develop 并用 CI 重新部署

适用于需要让仓库回到上一个稳定状态的情况。

```bash
git switch develop
git pull --ff-only
git revert --no-edit <bad-sha>
git push origin develop
gh run list --repo tomagoyaky/macos-hello --workflow ci.yml --limit 3
```

push 到 `develop` 会触发 `ci`，`deploy-staging` 重新运行。注意：当前测试套件有已知失败（见故障处理），修复前 CI 的 `test` 作业会阻断 `deploy-staging`，此时只能走方式一手工部署。

### 方式三：关闭 feature flag（当前不适用）

项目当前没有 feature flag 系统，也没有任何开关型环境变量。若未来引入，回滚流程为：

1. 在 GitHub `staging` 环境中把对应开关设为关闭（例如 `<FEATURE_NAME>=false`）。
2. 重新执行部署（方式一或方式二）。
3. 复跑冒烟检查，确认功能回到旧行为。

### 方式四：回滚数据库迁移（当前不适用）

项目没有数据库和迁移脚本，本方式无需执行。若未来引入数据库，必须在发布的同一变更中提供向下迁移脚本，并在回滚时按"先停写入、执行向下迁移、再部署旧版本、最后冒烟"的顺序操作。

## 故障处理

| 现象 | 可能原因 | 处理 |
|------|----------|------|
| `deploy-staging` 第一步失败，日志出现 `STAGING_DEPLOY_KEY is empty` | 环境 secret 未配置，或配到了 Repository secrets 之外的位置 | 在 Settings → Environments → `staging` → Environment secrets 添加 `STAGING_DEPLOY_KEY`；确认作业里的 `environment: staging` 未改名 |
| `deploy-staging` 一直显示 skipped | 触发事件不是 push，或分支不是 `develop` | 这是预期行为；PR 不部署。确认合并后的事件为 `push`、`github.ref` 为 `refs/heads/develop` |
| `test` 作业失败，7 个 `S7` 用例报 `workflow must define exactly one job with id "test"` 或 `name` 不是 `CI` | 新的 `ci.yml` 改为多作业、名称 `ci`、Node 22.x、仅 develop 触发，而 `test/workflow.test.js` 仍断言旧版单作业契约 | 已知问题。更新 `test/workflow.test.js` 使其匹配新契约（`name: ci`、`jobs: lint/test/build/deploy-staging`、Node `22.x`、develop 触发、保留零依赖断言步骤）后重跑 `pnpm test`。在测试更新前 CI 的 `deploy-staging` 不会被触发 |
| `setup-node` 报缓存错误或找不到 pnpm | 步骤顺序错误，或 pnpm 版本与 `packageManager` 不一致 | `pnpm/action-setup` 必须在 `actions/setup-node` 之前；`version` 必须是 `10.28.2` |
| 本地与 CI 的 Node 版本不一致 | 本地 `.nvmrc` 与 README 为 20.x，CI 为 22.x | 统一版本：要么把 CI 调回 20.x，要么同步更新 `.nvmrc`、README 与验收记录；当前两者不一致是已知风险 |
| 发往 `main` 的 PR 一直等待 `test` 检查 | 工作流只在 `develop` 触发，而 `main` 分支的 ruleset 要求必需检查 `test` | 在 `on.push` 与 `on.pull_request` 的 `branches` 中加入 `main`，或调整 `main` ruleset；否则 `main` 的 PR 无法合并 |
| live GitHub 用例显示 skip | 本地/CI 没有 `GH_TOKEN` 或 API 不可用，用例按设计跳过 | 预期行为；需要真实断言时在本地设置 `GH_TOKEN` 后重跑 |
| 测试通过了但 `test-report` artifact 缺失 | 作业在运行测试前就被取消，或上传步骤被跳过 | `Upload test report` 已设置 `if: always()`；检查 `test-results/` 是否创建、artifact 服务权限是否正常 |
| 占位部署显示绿色 | 占位命令不连接任何目标，成功只代表密钥存在与本机冒烟通过 | **部署未验证**，不得视为真实发布；务必按真实目标完成首次人工验证 |
| 依赖缓存未命中 | 首次运行或 `pnpm-lock.yaml` 变化 | 正常现象；项目无依赖，安装本身为 no-op，可忽略 |

## 责任人

| 角色 | 责任人 | 联系方式 | 职责 |
|------|--------|----------|------|
| 仓库所有者与最终审批 | tomagoyaky | GitHub @tomagoyaky | 审批 CI 契约变更、ruleset 与 `staging` 环境配置 |
| CI/CD 维护（DevOps） | DevOps Automator（本轮）/ 待指派 | 通过仓库 Issue 联系 | 维护 `ci.yml`、secrets 接入、部署目标配置与本文档更新 |
| 应用负责人 | 待指派 | 待补充 | 确认发布内容、执行冒烟检查、决定是否回滚 |
| 值班与应急响应 | 待指派 | 待补充 | 故障响应、执行回滚、记录事故结论 |

> 正式启用 staging 部署前，必须补齐"待指派/待补充"的真实负责人和联系方式，并完成一次带真实部署目标的演练。