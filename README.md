# Pump.fun & Raydium SDK

这是一个用于在 Solana 区块链上进行代币交易的 JavaScript SDK。支持通过 Pump.fun 协议和 Raydium DEX 进行交易。

## 功能特点

- 支持 Pump.fun 协议交易
- 支持 Raydium DEX 交易
- 集成 Jito MEV 服务提高交易成功率
- 支持自定义滑点设置
- 详细的交易日志输出

## 安装
```
git clone https://github.com/yuxel/pumpdotfun-sdk-common-js.git
```
```
npm install
```

## 配置
在项目根目录创建 `.env` 文件:
```
# RPC节点
RPC_URL=RPC搞里头

# Jito API
JITO_API_URL=https://amsterdam.mainnet.block-engine.jito.wtf/api/v1/transactions


# 钱包私钥
WALLET_PRIVATE_KEY=私钥搞里头


# 交易参数
SELL_PERCENT=100    # 100表示100%
BUY_AMOUNT_SOL=0.1    # 单位:SOL

# 滑点设置
SLIPPAGE_PERCENT=1    # 1表示1%

# Jito配置
JITO_TIP_SOL=0.0001    # 单位:SOL
```

## 使用方法
### Pump.fun 交易
```
Pump查询价格
npm run pump price <代币地址>
Pump买入代币
npm run pump buy <代币地址> <SOL数量>
Pump卖出代币
npm run pump sell <代币地址> <卖出比例>
```
### Raydium 交易
```
Raydium查询价格
npm run raydium price <代币地址>
Raydium买入代币
npm run raydium buy <代币地址> <SOL数量>
Raydium卖出代币
npm run raydium sell <代币地址> <卖出比例>
```

### 示例
```
查询代币价格
npm run pump price 7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU
买入 0.1 SOL的代币
npm run pump buy 7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU 0.1
卖出 50% 的代币
npm run pump sell 7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU 50
```

## 注意事项

1. 请确保您的钱包中有足够的 SOL 支付交易费用和 Jito 小费
2. 建议在进行大额交易前先使用小额测试
3. 合理设置滑点以平衡交易成功率和价格影响
4. 请妥善保管您的钱包私钥,不要泄露给他人

## 免责声明

本项目仅供学习研究使用,作者不对因使用本软件造成的任何损失负责。在使用本软件进行交易前,请充分了解相关风险。