// 过滤掉 punycode 废弃警告
process.removeAllListeners('warning');
process.on('warning', e => {
    if (e.name === 'DeprecationWarning' && e.message.includes('punycode')) {
        return;
    }
    console.warn(e.stack);
});

require('dotenv').config();
const { PublicKey, Connection, Keypair, LAMPORTS_PER_SOL } = require("@solana/web3.js");
const bs58 = require("bs58");
const { createConnection, pumpBuy, pumpSellPercent } = require('./IDL/pump-utils');
const logger = require('./utils/logger');

// 买入函数
async function buy(mintAddress, buyAmount, walletSecret = process.env.WALLET_PRIVATE_KEY) {
    try {
        const connection = new Connection(process.env.RPC_URL, "confirmed");
        const wallet = Keypair.fromSecretKey(new Uint8Array(bs58.decode(walletSecret)));

        // 记录开始时间
        const startTime = Date.now();

        // 买入前查询代币余额
        const tokenAccounts = await connection.getParsedTokenAccountsByOwner(
            wallet.publicKey,
            { programId: new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA') }
        );
        
        const beforeBalance = tokenAccounts.value.find(accountInfo => 
            new PublicKey(accountInfo.account.data.parsed.info.mint).equals(new PublicKey(mintAddress))
        )?.account.data.parsed.info.tokenAmount.uiAmount || 0;

        // 获取预计买入数量
        const { sdk } = createConnection(walletSecret);
        const mint = new PublicKey(mintAddress);
        const bondingCurveAccount = await sdk.getBondingCurveAccount(mint);
        const expectedTokens = bondingCurveAccount ? 
            bondingCurveAccount.getBuyPrice(BigInt(buyAmount * LAMPORTS_PER_SOL)) : null;

        // 购买代币
        let status = '失败';
        try {
            await pumpBuy(walletSecret, mintAddress, buyAmount);
            status = '成功';
        } catch (error) {
            throw error;
        }

        // 等待交易确认
        await new Promise(resolve => setTimeout(resolve, 5000));

        // 买入后查询余额
        const afterTokenAccounts = await connection.getParsedTokenAccountsByOwner(
            wallet.publicKey,
            { programId: new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA') }
        );
        
        const afterBalance = afterTokenAccounts.value.find(accountInfo => 
            new PublicKey(accountInfo.account.data.parsed.info.mint).equals(new PublicKey(mintAddress))
        )?.account.data.parsed.info.tokenAmount.uiAmount || 0;

        const endTime = Date.now();

        // 打印交易信息
        console.log("—————————购买——————————");
        console.log(`代币地址: ${mintAddress}`);
        console.log(`买入金额: ${buyAmount} SOL`);
        console.log(`买入前数量：${beforeBalance}`);
        console.log(`预计买入数量：${expectedTokens ? Number(expectedTokens) / 1e6 : null}`);
        console.log(`提交状态：${status}`);
        console.log(`等待交易确认...`);
        console.log(`上链耗时：${endTime - startTime}ms`);
        console.log(`买入后代币余额：${afterBalance}`);
        console.log(`买入代币价格：${(buyAmount / (afterBalance - beforeBalance)).toFixed(9)} SOL`);
        console.log("————————购买完成—————————");

        return {
            success: true,
            beforeBalance,
            afterBalance,
            amount: buyAmount,
            duration: endTime - startTime
        };
    } catch (error) {
        logger.error('操作失败: ' + error.message);
        logger.buyFail();
        return {
            success: false,
            error: error.message
        };
    }
}

// 卖出函数
async function sell(mintAddress, sellPercent, walletSecret = process.env.WALLET_PRIVATE_KEY) {
    try {
        const connection = new Connection(process.env.RPC_URL, "confirmed");
        const wallet = Keypair.fromSecretKey(new Uint8Array(bs58.decode(walletSecret)));

        // 记录开始时间
        const startTime = Date.now();

        // 卖出前查询SOL余额和代币余额
        const beforeSolBalance = await connection.getBalance(wallet.publicKey);
        const tokenAccounts = await connection.getParsedTokenAccountsByOwner(
            wallet.publicKey,
            { programId: new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA') }
        );

        const beforeBalance = tokenAccounts.value.find(accountInfo => 
            new PublicKey(accountInfo.account.data.parsed.info.mint).equals(new PublicKey(mintAddress))
        )?.account.data.parsed.info.tokenAmount.uiAmount || 0;

        // 卖出代币
        let status = '失败';
        try {
            await pumpSellPercent(walletSecret, mintAddress, sellPercent);
            status = '成功';
        } catch (error) {
            throw error;
        }

        // 等待交易确认
        await new Promise(resolve => setTimeout(resolve, 5000));

        // 卖出后查询余额
        const afterSolBalance = await connection.getBalance(wallet.publicKey);
        const afterTokenAccounts = await connection.getParsedTokenAccountsByOwner(
            wallet.publicKey,
            { programId: new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA') }
        );

        const afterBalance = afterTokenAccounts.value.find(accountInfo => 
            new PublicKey(accountInfo.account.data.parsed.info.mint).equals(new PublicKey(mintAddress))
        )?.account.data.parsed.info.tokenAmount.uiAmount || 0;

        const endTime = Date.now();
        const solProfit = (afterSolBalance - beforeSolBalance) / LAMPORTS_PER_SOL;
        const tokensSold = beforeBalance - afterBalance;

        // 打印交易信息
        console.log("—————————卖出——————————");
        console.log(`代币地址: ${mintAddress}`);
        console.log(`卖出比例: ${sellPercent}%`);
        console.log(`卖出前数量：${beforeBalance}`);
        console.log(`卖出数量：${tokensSold}`);
        console.log(`提交状态：${status}`);
        console.log(`等待交易确认...`);
        console.log(`上链耗时：${endTime - startTime}ms`);
        console.log(`卖出后代币余额：${afterBalance}`);
        console.log(`获得SOL：${solProfit}`);
        console.log(`卖出代币价格：${(solProfit / tokensSold).toFixed(9)} SOL`);
        console.log("————————卖出完成—————————");

        return {
            success: true,
            beforeBalance,
            afterBalance,
            solProfit,
            duration: endTime - startTime
        };
    } catch (error) {
        logger.error('操作失败: ' + error.message);
        logger.sellFail();
        return {
            success: false,
            error: error.message
        };
    }
}

// 查询代币价格
async function getTokenPrice(mintAddress, walletSecret = process.env.WALLET_PRIVATE_KEY) {
    try {
        const { sdk } = createConnection(walletSecret);
        const mint = new PublicKey(mintAddress);
        
        // 获取绑定曲线账户信息
        const bondingCurveAccount = await sdk.getBondingCurveAccount(mint);
        if (!bondingCurveAccount) {
            throw new Error("未找到绑定曲线账户");
        }

        // 计算买入0.1 SOL能买到多少代币
        const testAmount = 0.1 * LAMPORTS_PER_SOL;
        const buyTokens = Number(bondingCurveAccount.getBuyPrice(BigInt(testAmount))) / 1e6;
        const buyPrice = (0.1 / buyTokens); // 每个代币的SOL价格

        return {
            success: true,
            buyPrice,           // 每个代币的价格(SOL)
            pointOneSOLTokens: buyTokens  // 0.1 SOL能买多少代币
        };
    } catch (error) {
        console.log('详细错误:', error);
        return {
            success: false,
            error: error.message
        };
    }
}

// 如果是直接运行这个文件
if (require.main === module) {
    const args = process.argv.slice(2);
    const command = args[0];
    const mintAddress = args[1];

    if (!command || !mintAddress) {
        console.log('请使用: npm run pump buy <代币地址> <金额> 或 npm run pump sell <代币地址> <百分比> 或 npm run pump price <代币地址>');
        process.exit(1);
    }

    switch (command) {
        case 'price':
            getTokenPrice(mintAddress).then(result => {
                if (result.success) {
                    console.log("—————————价格查询——————————");
                    console.log(`合约地址: ${mintAddress}`);
                    console.log(`代币价格: ${result.buyPrice.toFixed(9)} SOL`);
                    console.log(`0.1 SOL 可买: ${result.pointOneSOLTokens.toFixed(5)} 个代币`);
                    console.log("————————查询完成—————————");
                } else {
                    console.log("————————查询失败—————————");
                    console.error('查询失败:', result.error);
                }
            });
            break;
        case 'buy':
            const buyAmount = args[2];
            buy(mintAddress, parseFloat(buyAmount || process.env.BUY_AMOUNT_SOL));
            break;
        case 'sell':
            const sellPercent = args[2];
            sell(mintAddress, parseInt(sellPercent || process.env.SELL_PERCENT));
            break;
        default:
            console.log('无效的命令。请使用 price、buy 或 sell');
            process.exit(1);
    }
}

module.exports = {
    buy,
    sell,
    getTokenPrice
}; 