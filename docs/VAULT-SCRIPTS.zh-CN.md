# Taproot 借贷金库脚本说明

## 1. 为什么有两个金库

抵押品先进入“等待放款金库”。Bob 真正放款时，该输出被花费，抵押品进入新的“活动贷款金库”。因此不会发生 Bob 没放款却取得抵押品，也不会在放款后继续使用旧退款出口。

## 2. 等待放款金库 Pending Vault

合作出口：

```text
<Alice x-only pubkey> OP_CHECKSIG
<Bob x-only pubkey> OP_CHECKSIGADD
OP_2 OP_NUMEQUAL
```

必须同时具有 Alice 和 Bob 的有效签名。该出口用于把抵押品转入活动贷款金库，并在同一笔交易中向 Alice 支付本金。

退款出口：

```text
<Funding Timeout> OP_CHECKSEQUENCEVERIFY OP_DROP
<Alice x-only pubkey> OP_CHECKSIG
```

等待期未满时不能使用；等待期满后仅 Alice 可以取回未获得放款的抵押品。

## 3. 活动贷款金库 Active Vault

合作出口与 Pending Vault 相同，需要 Alice 和 Bob 同时签名，用于确认正常还款后把抵押品返还 Alice。

违约出口：

```text
<Loan Term> OP_CHECKSEQUENCEVERIFY OP_DROP
<Bob x-only pubkey> OP_CHECKSIG
```

贷款期限未满时不能使用；期限届满后仅 Bob 可以取得抵押品。

## 4. Taproot 内部公钥

两个金库都采用无已知私钥的 NUMS internal key。正常的 key-path 不能绕过上述脚本出口。项目冻结的 NUMS x-only 公钥为：

```text
50929b74c1a04954b78b4b6035e97a5e078a5a0f28ec96d547bfee9ace803ac0
```

## 5. 当前验证范围

阶段 0 已验证脚本字节、Testnet4 地址、角色权限和相对区块条件的固定测试向量。真实 PSBT、Bitcoin 节点共识验证和 Testnet4 广播将在后续交易阶段验收。
