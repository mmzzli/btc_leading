# Bitcoin Asset Lending Tool

一个从零开始开发的 Bitcoin Testnet4 点对点资产抵押借贷项目。

当前阶段：重新定义为 BRC-20 商业借贷产品，先完成商业方案和协议评审，暂不开发链上交易。

- 第一版抵押资产：BRC-20
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

- [BRC-20 商业借贷产品方案](docs/BRC20-LENDING-COMMERCIAL-PLAN.zh-CN.md)
- [产品与协议设计](docs/ASSET-LENDING-DESIGN.zh-CN.md)
- [TRD 与分阶段验收计划](docs/ASSET-LENDING-TRD.zh-CN.md)

> 当前页面中的 Runes、固定测试地址和固定公钥属于早期技术原型，不代表新的产品方向，不能用于真实借贷。方案确认后将重做页面与 TRD。
