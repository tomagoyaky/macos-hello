# macos-hello 部署运行手册

> **状态：部署未验证。** 本仓库目前没有真实的 staging 目标（无 Dockerfile、无静态站点托管、无 K8s 清单、无部署脚本），`.github/workflows/ci.yml` 中 `deploy-staging` 的部署步骤是占位命令：它只校验 `STAGING_DEPLOY_KEY` 非空、打印将要部署的版本信息，然后在 CI runner 上跑本机冒烟检查。在接入真实 staging 目标并完成首次人工验证之前，`deploy-staging` 显示绿色**不代表**应用已经发布。
>
> 运行手册对应的工作流：`CI`（文件 `.github/workflows/ci.yml`）；基线分支：`develop`；自动部署只在 push 到 `develop` 时触发。

## 前置条件

| 项目 | 要求 |
|------|------|
| 代码仓库 | `git@github.com:tomagoyaky/macos-hello.git`（私有），基线分支 `develop` |
| 运行平台 | 产品目标平台为 macOS；CI runner 为 `ubuntu-latest`，只用于持续集成与 runner 内的冒烟检查 |
| Node.js | `package.json` 的 `engines.node` 为 `>=20`，本地 `.nvmrc` 为 `20`，CI 所有 `actions/setup-node` 固定 `20.x`。本地必须使用 Node 20，避免与 CI 行为漂移 |
| pnpm | `10.28.2`，与 `package.json` 的 `packageManager` 字段一致。CI 用 `pnpm/action-setup@v4` 显式安装该版本，不依赖 corepack |
| 依赖 | 零运行时依赖、零开发依赖；`pnpm install --frozen-lockfile` 实际为空操作，但仍必须执行以保证与 CI 一致 |
| 锁文件 | `pnpm-lock.yaml`（lockfileVersion 9.0）已提交；CI 的 `setup-node` 按它做 pnpm 缓存 |
| 数据库 / 迁移 | 无数据库、无迁移脚本、无 feature flag 系统 |
| GitHub 权限 | 仓库 write；Actions 读取；`staging` 环境 secret 的管理权限 |
| GitHub Environment | 必须存在名为 `staging` 的环境，且在其 Environment secrets 中配置 `STAGING_DEPLOY_KEY` |
| 分支保护 | `main` 的 ruleset `main-protection` 要求必需状态检查上下文为 `test`；工作流中 `test` 这个 job id 与 name 都不可改名 |
| 本地工具 | `git`、`node`（20.x）、`pnpm`（10.28.2）、可选 `gh` CLI |

## 环境变量与 Secrets

| 名称 | 用途 | 配置位置 | 是否必需 |
|------|------|----------|----------|
| `STAGING_DEPLOY_KEY` | staging 部署凭据。当前只做非空校验，占位部署不会读取其值，也不会打印到日志 | GitHub 仓库 Settings → Environments → `staging` → Environment secrets（不是 Repository secrets） | 是。为空时 `deploy-staging` 第一步输出 `::error::` 并以退出码 1 失败 |
| `GH_TOKEN` | 可选。注入 `test` job 后，`test/ruleset.test.js` 的 4 条 S8 分支保护实时检查才会真正访问 GitHub API 校验 ruleset；未配置时这 4 条用例自动跳过且整轮测试仍为通过 | Repository secrets（Settings → Secrets and variables → Actions）；读取 ruleset 需要该令牌具备仓库 administration 读权限，默认的 `GITHUB_TOKEN` 不满足 | 否。未配置时 S8 检查处于「静默跳过」状态，`main` 分支保护不会被 CI 校验 |
| `GITHUB_TOKEN` | Actions 自动注入的令牌。工作流顶层 `permissions` 恰好为 `{ contents: read }`，未在步骤中显式使用 | GitHub Actions 内置 | 自动，无需配置 |
| `GITHUB_REPOSITORY` | 内置的 `owner/repo` 标识，占位部署日志会打印 | GitHub Actions 内置 | 自动 |
| `GITHUB_SHA` | 内置的触发提交 SHA，用于标识将要部署的版本 | GitHub Actions 内置 | 自动 |
| `GITHUB_REF_NAME` | 内置的触发分支名 | GitHub Actions 内置 | 自动 |
| `CI` | 标记运行在 CI 环境（非密钥） | GitHub Actions 内置 | 自动 |
| 应用环境变量 | 该 CLI 不读取任何业务环境变量 | 无 | 无 |

规则：任何 token、密码、私钥只能通过环境变量或 GitHub Secrets 注入；禁止写入仓库、文档、示例或 CI 日志。本文档只列变量名称，不记录取值。

## 部署步骤

### 方式一：CI 自动部署（push 到 develop）

1. 从 `develop` 切分支开发，并在本地跑完全部校验：

   ```bash
   git fetch origin
   git switch develop
   git pull --ff-only
   git switch -c feature/<desc>
   pnpm install --frozen-lockfile
   pnpm run lint
   pnpm test
   pnpm run build
   node bin/hello.js
   ```

   预期：`pnpm test` 退出码 0（90 个用例全部通过，失败数为 0），`node bin/hello.js` 输出 `Hello, World!`。

2. 提交并推送功能分支：

   ```bash
   git add <files>
   git commit -m "feat(scope): <description>"
   git push -u origin feature/<desc>
   ```

3. 创建 PR 合并到 `develop`（PR 事件只运行 `lint`、`test`、`build`，`deploy-staging` 因 `if` 条件被跳过，这是预期行为）：

   ```bash
   gh pr create --repo tomagoyaky/macos-hello --base develop --head feature/<desc> --title "<title>" --body "<body>"
   gh pr checks --repo tomagoyaky/macos-hello --watch
   gh pr merge --repo tomagoyaky/macos-hello --merge <pr-number> --delete-branch
   ```

   也可直接推送 `develop`：

   ```bash
   git switch develop
   git pull --ff-only
   git merge --ff-only feature/<desc>
   git push origin develop
   ```

4. 推送或合并产生的 push 事件会触发工作流 `CI`，各 job 依次执行：

   | 顺序 | job | 执行的命令 |
   |------|-----|-----------|
   | 1 | `lint` | `pnpm install --frozen-lockfile` → `pnpm run lint` → 对 `bin/*.js src/*.js test/*.js test-support/*.js` 逐个 `node --check` |
   | 2 | `test` | `pnpm install --frozen-lockfile` → `pnpm test`（输出同时写入 `test-results/test.log`，设置 `pipefail` 保证测试失败不被 `tee` 吞掉）→ 零运行时依赖断言（成功时打印 `runtime dependencies: 0`）→ 上传 artifact `test-report` |
   | 3 | `build` | `pnpm install --frozen-lockfile` → `pnpm run build` |
   | 4 | `deploy-staging` | 仅 `push` 且 `github.ref == 'refs/heads/develop'` 时运行，挂载 `staging` 环境 |

5. 查看运行状态与结论：

   ```bash
   gh run list --repo tomagoyaky/macos-hello --workflow ci.yml --limit 5
   gh run watch --repo tomagoyaky/macos-hello <run-id> --exit-status
   ```

6. `deploy-staging` 内部实际执行的命令（当前为占位实现，**部署未验证**）：

   ```bash
   # Step 1: fail fast when the environment secret is missing
   if [ -z "${STAGING_DEPLOY_KEY}" ]; then
     echo "::error::STAGING_DEPLOY_KEY is empty. Configure it in Settings > Environments > staging > Environment secrets."
     exit 1
   fi

   # Step 2: placeholder deployment (deployment not verified)
   echo "::warning::No staging deploy target is configured; running the placeholder deploy. Deployment not verified."
   echo "Would deploy ${GITHUB_REPOSITORY}@${GITHUB_SHA} from ${GITHUB_REF_NAME} to environment staging."

   # Step 3: smoke checks on the runner (verifies the repository, not a deployed host)
   test "$(node bin/hello.js)" = "Hello, World!"
   test "$(node bin/hello.js --name Alice)" = "Hello, Alice!"
   echo "smoke checks passed"
   ```

   第 2 步不会连接任何目标，所以这一步成功只说明密钥存在、仓库内冒烟通过，不能据此报告上线成功。

### 方式二：本地复现全套校验（无需部署目标）

在没有真实 staging 主机时，用下面的命令在本机复现 CI 的全部检查：

```bash
git clone git@github.com:tomagoyaky/macos-hello.git
cd macos-hello
git switch develop
nvm use 20
pnpm install --frozen-lockfile
pnpm run lint
for file in bin/*.js src/*.js test/*.js test-support/*.js; do node --check "$file"; done
pnpm test
pnpm run build
node bin/hello.js
```

预期：所有命令退出码 0，最后一行输出 `Hello, World!`。

### 接入真实 staging 目标后替换占位步骤（尚未验证）

拿到 staging 主机、用户名和部署私钥（存为 `STAGING_DEPLOY_KEY`）后，把 `Deploy to staging (placeholder, deployment not verified)` 步骤替换为类似命令，并在首次执行后回填本节：

```bash
# Write the deploy key without echoing it
mkdir -p ~/.ssh && chmod 700 ~/.ssh
printf '%s\n' "$STAGING_DEPLOY_KEY" > ~/.ssh/staging_deploy_key
chmod 600 ~/.ssh/staging_deploy_key

# Package the exact commit
mkdir -p dist
git archive --format=tar.gz --prefix=macos-hello/ -o "dist/macos-hello-${GITHUB_SHA}.tar.gz" HEAD

# Upload and switch the release symlink
scp -i ~/.ssh/staging_deploy_key "dist/macos-hello-${GITHUB_SHA}.tar.gz" <user>@<staging-host>:/opt/macos-hello/releases/
ssh -i ~/.ssh/staging_deploy_key <user>@<staging-host> "tar -xzf /opt/macos-hello/releases/macos-hello-${GITHUB_SHA}.tar.gz -C /opt/macos-hello/releases && ln -sfn /opt/macos-hello/releases/macos-hello-${GITHUB_SHA} /opt/macos-hello/current"

# Smoke check the deployed release
ssh -i ~/.ssh/staging_deploy_key <user>@<staging-host> "/opt/macos-hello/current/bin/hello.js"
```

替换后必须完成一次带真实目标的演练，并把"部署未验证"的标注从本手册和 PR 描述中移除。

## 冒烟检查

以下检查项均可直接执行，按预期结果判定通过与否。

| 检查项 | 命令 | 预期结果 |
|--------|------|----------|
| 默认问候 | `node bin/hello.js` | stdout 恰为 `Hello, World!`（含末尾一个换行），退出码 0，stderr 为空 |
| 具名问候（空格形式） | `node bin/hello.js --name Alice` | stdout 恰为 `Hello, Alice!`，退出码 0 |
| 具名问候（等号形式） | `node bin/hello.js --name=Alice` | stdout 恰为 `Hello, Alice!`，退出码 0 |
| 未知选项 | `node bin/hello.js --bogus` | 退出码 1，stderr 为 `Usage: hello [--name <name>]`，stdout 为空 |
| 缺失取值 | `node bin/hello.js --name` | 退出码 1，stderr 为 `Usage: hello [--name <name>]` |
| 空字符串取值 | `node bin/hello.js --name ''` | 退出码 1，stderr 为 `Usage: hello [--name <name>]` |
| 语法检查（lint） | `pnpm run lint` | 退出码 0 |
| 全量语法检查 | `for file in bin/*.js src/*.js test/*.js test-support/*.js; do node --check "$file"; done` | 退出码 0，无输出 |
| 构建检查 | `pnpm run build` | 退出码 0（本仓库无构建产物，仅做入口语法检查） |
| 测试套件 | `pnpm test` | 退出码 0，`fail 0`（当前为 90 个用例全部通过）；未配置 `GH_TOKEN` 时 4 条 S8 实时检查显示 skipped 也属预期 |
| CI 测试报告 | 在 Actions 运行页下载 artifact `test-report` | 包含 `test.log`，内容与 `pnpm test` 输出一致，保留 7 天 |
| CI 部署冒烟 | `deploy-staging` 的 `Smoke check` 步骤 | 日志末行为 `smoke checks passed`，且同一次运行中出现 `::warning::... Deployment not verified.` |
| CI 密钥校验 | `deploy-staging` 的 `Require STAGING_DEPLOY_KEY` 步骤 | 日志含 `STAGING_DEPLOY_KEY is configured.` |

可一次性执行的冒烟脚本（已本地验证）：

```bash
set -euo pipefail
test "$(node bin/hello.js)" = "Hello, World!"
test "$(node bin/hello.js --name Alice)" = "Hello, Alice!"
test "$(node bin/hello.js --name=Alice)" = "Hello, Alice!"
if usage_output=$(node bin/hello.js --bogus 2>&1); then
  echo "expected exit code 1 for unknown options" >&2
  exit 1
fi
test "$usage_output" = "Usage: hello [--name <name>]"
for file in bin/*.js src/*.js test/*.js test-support/*.js; do node --check "$file"; done
pnpm run lint
pnpm run build
echo "smoke checks passed"
```

真实 staging 目标接入后，冒烟检查必须增加一条针对部署主机的验证（例如上面的 `ssh ... /opt/macos-hello/current/bin/hello.js`），并核对输出与 `Hello, World!` 一致。

## 回滚步骤

### 方式一：重新部署上一个版本（推荐，不改业务代码）

适用于新版本在 staging 出错、需要立即恢复旧版本的情况。

1. 定位上一个稳定提交：

   ```bash
   git fetch origin develop
   git log --oneline -10 origin/develop
   ```

2. 用 `git revert` 生成反向提交并推送 `develop`，让 CI 重新执行并触发 `deploy-staging`：

   ```bash
   git switch develop
   git pull --ff-only
   git revert --no-edit <bad-sha>
   git push origin develop
   gh run list --repo tomagoyaky/macos-hello --workflow ci.yml --limit 3
   ```

3. 接入真实 staging 目标后，也可以按"替换占位步骤"中的模板直接重新打包并部署 `<previous-sha>`，把 `/opt/macos-hello/current` 软链接指回旧版本目录：

   ```bash
   git archive --format=tar.gz --prefix=macos-hello/ -o "dist/macos-hello-<previous-sha>.tar.gz" <previous-sha>
   scp -i <deploy-key-path> "dist/macos-hello-<previous-sha>.tar.gz" <user>@<staging-host>:/opt/macos-hello/releases/
   ssh -i <deploy-key-path> <user>@<staging-host> "tar -xzf /opt/macos-hello/releases/macos-hello-<previous-sha>.tar.gz -C /opt/macos-hello/releases && ln -sfn /opt/macos-hello/releases/macos-hello-<previous-sha> /opt/macos-hello/current"
   ```

4. 按"冒烟检查"逐项复验。当前占位部署下，第 3 步无法执行，**部署未验证**。

### 方式二：关闭 feature flag（当前不适用）

项目目前没有任何 feature flag 或开关型环境变量，因此不存在可关闭的开关。若未来引入，回滚流程为：

1. 在 GitHub `staging` 环境中把对应开关设为关闭（例如把环境变量改为 `<FEATURE_NAME>=false`）。
2. 重新执行部署（见「部署步骤」中的方式一或方式二）。
3. 复跑冒烟检查，确认行为回到旧版本。

### 方式三：回滚数据库迁移（当前不适用）

项目没有数据库、没有迁移脚本，也无持久化状态，本方式无需执行。若未来引入数据库，必须在同一次发布中提供向下迁移脚本，并按"先停止写入 → 执行向下迁移 → 部署旧版本 → 冒烟复验"的顺序操作；迁移脚本缺失时禁止发布。

## 故障处理

| 现象 | 可能原因 | 处理 |
|------|----------|------|
| `deploy-staging` 第一步失败，日志含 `STAGING_DEPLOY_KEY is empty` | 环境 secret 未配置，或配到了 Repository secrets 之外的位置 | 在 Settings → Environments → `staging` → Environment secrets 添加 `STAGING_DEPLOY_KEY`；确认 job 中的 `environment: staging` 未被改名 |
| `deploy-staging` 一直显示 skipped | 触发事件不是 push，或分支不是 `develop` | 预期行为；PR 不部署。确认合并后事件为 `push`、`github.ref` 为 `refs/heads/develop` |
| `pnpm test` 失败但 `test-results/test.log` 显示正常 | 历史版本缺少 `pipefail`，管道退出码被 `tee` 覆盖 | 当前 `Run tests` 步骤已加 `set -o pipefail`；若回退过该文件，先恢复再排查测试本身 |
| `test` job 报 `workflow must define a job with id "test"` 或 `name` 不是 `CI` | `ci.yml` 的 name、job id/name 被改动，违反 `test/workflow.test.js` 的 S7 契约 | 恢复 `name: CI`，并让 test job 的 id 与 name 都是 `test`、`runs-on: ubuntu-latest`、`timeout-minutes: 10`；不得为通过 CI 而放宽契约测试，除非同步变更 `main` ruleset 的必需检查上下文 |
| `setup-node` 报缓存错误或找不到 pnpm | 步骤顺序错误，或 pnpm 版本与 `packageManager` 不一致 | `pnpm/action-setup@v4` 必须在 `actions/setup-node@v4` 之前，`version` 必须是 `10.28.2`，`cache-dependency-path` 指向 `pnpm-lock.yaml` |
| 本地测试通过、CI 失败（或相反） | 本地 Node 不是 20.x（例如 Node 25 与本仓库 `.nvmrc` 不一致） | 本地执行 `nvm use 20` 后重跑；CI 所有 `setup-node` 固定 `20.x`，不要单独调高某个 job |
| S8 分支保护用例显示 skipped | CI 未配置可读 ruleset 的 `GH_TOKEN`，或本地没有 `gh` 登录 | 预期降级行为。需要真实校验时配置具备 administration 读权限的 `GH_TOKEN` |
| 发往 `main` 的 PR 一直等待 `test` 检查 | 工作流只在 `develop` 触发，而 `main` ruleset 要求必需检查 `test` | 在 `on.push` / `on.pull_request` 的 `branches` 中加入 `main`（需同步评估部署 job 的 `if` 条件），或调整 `main` ruleset |
| 测试通过但 `test-report` artifact 缺失 | 作业在运行测试前被取消，或上传步骤被跳过 | 上传步骤已设 `if: always()`；检查 `test-results/` 是否创建、artifact 服务是否正常 |
| 占位部署显示绿色 | 占位命令不连接任何目标，成功只代表密钥存在与 runner 内冒烟通过 | **部署未验证**，不得视为真实发布；必须接入真实目标并完成首次人工验证 |
| 依赖缓存未命中 | 首次运行或 `pnpm-lock.yaml` 变化 | 正常现象；项目无依赖，安装为空操作，可忽略 |
| Node 20 到期升级 | Node 20 于 2026-04 结束上游维护，属已知升级债 | 升级时同步修改 `package.json` 的 `engines.node`、`.nvmrc`、CI 的 `node-version`、README 与本文档，并全量回归 |

## 责任人

| 角色 | 责任人 | 联系方式 | 职责 |
|------|--------|----------|------|
| 仓库所有者与最终审批 | tomagoyaky | GitHub @tomagoyaky | 审批 CI 契约变更、ruleset 与 `staging` 环境配置 |
| CI/CD 维护（DevOps） | DevOps Automator（本轮）/ 待指派 | 通过仓库 Issue 联系 | 维护 `ci.yml`、secrets 接入、部署目标配置与本文档更新 |
| 应用负责人 | 待指派 | 待补充 | 确认发布内容、执行冒烟检查、决定是否回滚 |
| 值班与应急响应 | 待指派 | 待补充 | 故障响应、执行回滚、记录事故结论 |

> 正式启用 staging 部署前，必须补齐"待指派 / 待补充"的真实负责人与联系方式，并完成一次带真实部署目标的演练。在此之前，部署状态一律标注为"部署未验证"。