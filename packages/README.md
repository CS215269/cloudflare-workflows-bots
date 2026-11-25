# packages/

跨 bot 复用的共享代码。

当前各 bot 尚未抽取公共包 —— `weather-bot` 的聚合/卡片/签名逻辑仍在
`bots/weather-bot/src/lib/` 内。等出现第二个 bot 且确实存在重复逻辑时，再抽到这里。

## 抽取原则

- 只有**确实重复**且**语义稳定**的逻辑才下沉（例如飞书卡片渲染、签名、多源聚合框架）
- 共享包保持零运行时依赖（纯 TypeScript），具体数据源实现仍留在各 bot 内
- 共享包不发到 Workers 运行时（各自 `wrangler.toml` 只打包自己的 `src/`），
  通过 workspace 依赖（`"my-lib": "*"`）在构建期内联
