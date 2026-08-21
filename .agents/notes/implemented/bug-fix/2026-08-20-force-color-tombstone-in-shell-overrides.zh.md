# Agent Note: Shell 环境覆盖以墓碑清除外部继承的 FORCE_COLOR

Status: implemented

[English](2026-08-20-force-color-tombstone-in-shell-overrides.md) | 中文

## Problem

只要同时设置了 `FORCE_COLOR`，Node 就会忽略 `NO_COLOR`、保留颜色，并向 stderr 打印一行指出该冲突的警告。`dsh-bash-local` 与 `dsh-pwsh-local` 在 `ENV_OVERRIDES` 中设置 `NO_COLOR: '1'`，以保证工具输出不含转义序列，但它合并在一份仍携带任意外部 `FORCE_COLOR` 的继承环境之上。因此，从强制着色的终端启动的 `dsh`，会为模型运行的每一条基于 Node 的命令返回转义序列外加两行警告，既违背了这些覆盖项声明的用途，也使模型可见的工具输出取决于启动环境。

同一冲突使 `scripts/oxlint-contract.spec.ts` 失败：它的两个 spawn 辅助函数以相同方式构造环境，并断言一次成功的 `--fix` 运行的 stderr 为空。该失败在任何导出 `FORCE_COLOR` 的主机上都必然发生——其中包括本仓库推荐用于开发的 agent harness——而在不设置该变量的 CI 中不可见。

已录制的无密钥快照语料未受影响：其中既没有转义序列，也没有警告文本。三个 acp-agent 场景（`bash-spill`、`code-mode-read-image`、`cancel-tool-calls`）通过 shell 运行 `node -e`，因此若从强制着色的终端重新录制，就会把这两种产物写入那一层的期望输出，而该层的存在正是为了钉住模型可见的字节。

## Decision

两张 `ENV_OVERRIDES` 表都在 `NO_COLOR: '1'` 旁携带 `FORCE_COLOR: undefined`。`childEnv()` 已将"键存在且值为 `undefined`"定义为墓碑，用于移除一个普通的外部条目，因此子进程完全看不到 `FORCE_COLOR`，而不是看到一个相互竞争的值。

`scripts/oxlint-contract.spec.ts` 提升出一个删除了 `FORCE_COLOR` 的 `inheritedEnv` 基底，并由两个 spawn 辅助函数共用，同时保留 stderr 为空的断言：一次成功的 fix 保持输出通道干净，正是被测的契约。

## Alternatives considered

**放宽该 spec 中 stderr 为空的断言。** 已拒绝，因为它断言的是一项真实契约，而污染来自环境；放宽它只会掩盖同一冲突在产品侧造成的缺陷。

**改为设置 `FORCE_COLOR: '0'` 而非墓碑。** 已拒绝，尽管这对 Node 足够：Node 将 `0` 视为不着色且不发出警告。但它使该变量保持被设置状态，仅检测其是否存在的工具仍会强制着色，因此墓碑是更强的保证，并且复用了 `childEnv()` 已经拥有的词汇。

**在 `scrubbedParentEnv()` 中丢弃 `FORCE_COLOR`。** 已拒绝，因为该函数拥有的是凭据形状的名称与 `DSH_` 前缀。颜色策略属于声明它的 shell 后端，而有意需要继承颜色的 subprocess 消费方仍应保留它。

## Consequences

基于 Node 的命令的工具输出现在不再取决于启动终端，这正是 `ENV_OVERRIDES` 声称却未兑现的行为。通过 `spec.env` 或 `spec.dshEnv` 显式传入自己的 `FORCE_COLOR` 的调用方仍然胜出，因为这些覆盖项先行合并。

`dsh-pwsh-local` 是 `dsh-bash-local` 的逐调用镜像，因此墓碑要么两侧同时落地，要么两者漂移。两侧各有一个缺少它就会失败的测试：bash 通过一条真实命令断言子进程看不到 `FORCE_COLOR` 而 `NO_COLOR` 得以保留，pwsh 则在捕获到的 spawn spec 上断言该墓碑，可在未安装 `pwsh` 的主机上运行。
