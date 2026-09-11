# Bitcoin Asset Lending Tool

一个从零开始开发的 Bitcoin Testnet4 点对点资产抵押借贷项目。

当前阶段：阶段 0 技术基线已通过，阶段 1 的贷款条款确认页面已可预览。链上交易功能尚未开放。

- 第一版抵押资产：Runes
- 网络：Bitcoin Testnet4
- 钱包：UniSat
- 项目边界：独立源码、依赖、构建、测试和 Git 历史

## 本地运行

```bash
npm install
npm run dev
```

质量检查：

```bash
npm test
npm run build
```

设计与验收文档：

- [产品与协议设计](docs/ASSET-LENDING-DESIGN.zh-CN.md)
- [TRD 与分阶段验收计划](docs/ASSET-LENDING-TRD.zh-CN.md)
