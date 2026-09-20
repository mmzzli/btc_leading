# Bitcoin Asset Lending Tool

一个从零开始开发的 Bitcoin Testnet4 点对点资产抵押借贷项目。

当前阶段：Bitcoin Testnet4 手工协调版 BRC-20 借贷流程已经实现。支持 Bob 报价、Alice 接受与抵押准备、双方原子激活、正常还款和逾期领取。交易构造与签名路径已经通过自动化测试，尚待使用两只真实 UniSat Testnet4 钱包完成整套广播验收。双方暂时通过复制 JSON 交接交易包，商业部署需要后端协调服务替代手工交接。

- 第一版抵押资产：BRC-20
- 网络：Bitcoin Testnet4
- 钱包：UniSat
- 项目边界：独立源码、依赖、构建、测试和 Git 历史

## 本地运行

```bash
npm install
npm run dev
```

请在装有 UniSat Wallet 的 Chrome 中访问终端显示的地址，并将钱包切换到 Bitcoin Testnet4。Codex 内置浏览器可预览页面，但无法加载 UniSat 扩展。

如需查询 Alice 的 BRC-20 余额：

```bash
cp .env.example .env.local
```

然后在 `.env.local` 填写 Testnet4 UniSat OpenAPI Key 并重启开发服务。此方式只用于本地原型；商业部署必须由后端保存 Key 并代理查询。

质量检查：

```bash
npm test
npm run build
```

设计与验收文档：

- [BRC-20 商业借贷产品方案](docs/BRC20-LENDING-COMMERCIAL-PLAN.zh-CN.md)
- [早期 Runes 技术设计（归档参考）](docs/ASSET-LENDING-DESIGN.zh-CN.md)
- [早期 Runes TRD（归档参考）](docs/ASSET-LENDING-TRD.zh-CN.md)

> 页面中的放款、还款和违约领取会广播真实 Testnet4 交易。签名前必须在 UniSat 中核对资产、金额和地址；测试网资产没有市场价值。
