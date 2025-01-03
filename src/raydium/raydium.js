require('dotenv').config();
const { PublicKey, Connection, Keypair, LAMPORTS_PER_SOL } = require('@solana/web3.js');
const { NATIVE_MINT, getAssociatedTokenAddress, TOKEN_PROGRAM_ID } = require('@solana/spl-token');
const bs58 = require('bs58');
const { getPoolKeys } = require('./baseMint');
const { getBuyTx, getSellTx } = require('./swap');
const { jsonInfo2PoolKeys, Liquidity, Token, TokenAmount, Percent } = require('@raydium-io/raydium-sdk');

// 买入函数
async function buy(mintAddress, buyAmount, walletSecret = process.env.WALLET_PRIVATE_KEY) {
    try {
        const connection = new Connection(process.env.RPC_URL, "confirmed");
        const wallet = Keypair.fromSecretKey(new Uint8Array(bs58.decode(walletSecret)));
        const baseMint = new PublicKey(mintAddress);

        // 记录开始时间
        const startTime = Date.now();

        // 买入前查询代币余额
        const tokenAccounts = await connection.getParsedTokenAccountsByOwner(
            wallet.publicKey,
            { programId: TOKEN_PROGRAM_ID }
        );
        
        const beforeBalance = tokenAccounts.value.find(accountInfo => 
            new PublicKey(accountInfo.account.data.parsed.info.mint).equals(baseMint)
        )?.account.data.parsed.info.tokenAmount.uiAmount || 0;

        // 获取池信息
        const poolKeys = await getPoolKeys(baseMint, connection);
        if (!poolKeys) {
            throw new Error('获取池信息失败');
        }

        const poolId = new PublicKey(poolKeys.id);

        // 获取预计买入数量
        const poolInfo = await Liquidity.fetchInfo({
            connection,
            poolKeys: jsonInfo2PoolKeys(poolKeys)
        });

        const quoteToken = new Token(TOKEN_PROGRAM_ID, NATIVE_MINT, 9);
        const baseToken = new Token(TOKEN_PROGRAM_ID, baseMint, poolKeys.baseDecimals);
        const solAmount = new TokenAmount(quoteToken, buyAmount * LAMPORTS_PER_SOL);

        const { amountOut: expectedTokens } = Liquidity.computeAmountOut({
            poolKeys: jsonInfo2PoolKeys(poolKeys),
            poolInfo,
            amountIn: solAmount,
            currencyOut: baseToken,
            slippage: new Percent(process.env.SLIPPAGE_PERCENT || 1, 100)
        });

        const expectedAmount = Number(expectedTokens.toExact()) * 1000;  // 乘以1000来调整数量

        // 生成并提交交易
        let status = '失败';
        const tx = await getBuyTx(
            connection, 
            wallet, 
            baseMint, 
            NATIVE_MINT, 
            buyAmount, 
            poolId.toBase58(), 
            parseInt(process.env.SLIPPAGE_PERCENT || 1) * 100
        );
        if (tx) {
            const base58Transaction = bs58.encode(tx.serialize());
            await submitToJito(base58Transaction);
            status = '成功';
        }

        // 等待交易确认
        await new Promise(resolve => setTimeout(resolve, 5000));

        // 买入后查询余额
        const afterTokenAccounts = await connection.getParsedTokenAccountsByOwner(
            wallet.publicKey,
            { programId: TOKEN_PROGRAM_ID }
        );
        
        const afterBalance = afterTokenAccounts.value.find(accountInfo => 
            new PublicKey(accountInfo.account.data.parsed.info.mint).equals(baseMint)
        )?.account.data.parsed.info.tokenAmount.uiAmount || 0;

        const endTime = Date.now();

        // 打印交易信息
        console.log("—————————购买——————————");
        console.log(`代币地址: ${mintAddress}`);
        console.log(`买入金额: ${buyAmount} SOL`);
        console.log(`买入前数量：${beforeBalance}`);
        console.log(`预计买入数量：${expectedAmount.toFixed(5)}`);  // 使用调整后的数量
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
        console.error('买入失败:', error.message);
        return { success: false, error: error.message };
    }
}

// 卖出函数
async function sell(mintAddress, sellPercent, walletSecret = process.env.WALLET_PRIVATE_KEY) {
    try {
        const connection = new Connection(process.env.RPC_URL, "confirmed");
        const wallet = Keypair.fromSecretKey(new Uint8Array(bs58.decode(walletSecret)));
        const baseMint = new PublicKey(mintAddress);

        // 记录开始时间
        const startTime = Date.now();

        // 卖出前查询SOL余额和代币余额
        const beforeSolBalance = await connection.getBalance(wallet.publicKey);
        const tokenAccounts = await connection.getParsedTokenAccountsByOwner(
            wallet.publicKey,
            { programId: TOKEN_PROGRAM_ID }
        );

        const beforeBalance = tokenAccounts.value.find(accountInfo => 
            new PublicKey(accountInfo.account.data.parsed.info.mint).equals(baseMint)
        )?.account.data.parsed.info.tokenAmount.uiAmount || 0;

        // 获取池信息
        const poolKeys = await getPoolKeys(baseMint, connection);
        if (!poolKeys) {
            throw new Error('获取池信息失败');
        }

        const poolId = new PublicKey(poolKeys.id);

        // 计算卖出数量
        const tokenAta = await getAssociatedTokenAddress(baseMint, wallet.publicKey);
        const tokenBalInfo = await connection.getTokenAccountBalance(tokenAta);
        const tokenBalance = tokenBalInfo.value.amount;
        const sellAmount = Math.floor(tokenBalance * (sellPercent / 100));

        // 生成并提交交易
        let status = '失败';
        const tx = await getSellTx(
            connection, 
            wallet, 
            baseMint, 
            NATIVE_MINT, 
            sellAmount, 
            poolId.toBase58(), 
            parseInt(process.env.SLIPPAGE_PERCENT || 1) * 100
        );
        if (tx) {
            const base58Transaction = bs58.encode(tx.serialize());
            await submitToJito(base58Transaction);
            status = '成功';
        }

        // 等待交易确认
        await new Promise(resolve => setTimeout(resolve, 5000));

        // 卖出后查询余额
        const afterSolBalance = await connection.getBalance(wallet.publicKey);
        const afterTokenAccounts = await connection.getParsedTokenAccountsByOwner(
            wallet.publicKey,
            { programId: TOKEN_PROGRAM_ID }
        );

        const afterBalance = afterTokenAccounts.value.find(accountInfo => 
            new PublicKey(accountInfo.account.data.parsed.info.mint).equals(baseMint)
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
        console.error('卖出失败:', error.message);
        return { success: false, error: error.message };
    }
}

// 查询价格
async function getPrice(mintAddress) {
    try {
        const connection = new Connection(process.env.RPC_URL, 'confirmed');
        const baseMint = new PublicKey(mintAddress);

        // 获取池信息
        const poolKeys = await getPoolKeys(baseMint, connection);
        if (!poolKeys) {
            throw new Error('获取池信息失败');
        }

        const poolId = new PublicKey(poolKeys.id);
        
        // 获取池的流动性信息
        const poolInfo = await Liquidity.fetchInfo({
            connection,
            poolKeys: jsonInfo2PoolKeys(poolKeys)
        });

        // 计算买入0.1 SOL能得到多少代币
        const quoteToken = new Token(TOKEN_PROGRAM_ID, NATIVE_MINT, 9);
        const baseToken = new Token(TOKEN_PROGRAM_ID, baseMint, poolKeys.baseDecimals);
        const pointOneSOL = new TokenAmount(quoteToken, LAMPORTS_PER_SOL / 10); // 0.1 SOL

        // 计算买入价格
        const { amountOut: buyTokens } = Liquidity.computeAmountOut({
            poolKeys: jsonInfo2PoolKeys(poolKeys),
            poolInfo,
            amountIn: pointOneSOL,
            currencyOut: baseToken,
            slippage: new Percent(process.env.SLIPPAGE_PERCENT || 1, 100)
        });

        // 计算价格
        const pointOneSOLTokens = Number(buyTokens.toExact()) * 1000; // 乘以1000来调整数量
        const buyPrice = 0.1 / pointOneSOLTokens;  // 每个代币需要多少 SOL

        console.log("—————————价格查询——————————");
        console.log(`合约地址: ${mintAddress}`);
        console.log(`代币价格: ${buyPrice.toFixed(9)} SOL`);
        console.log(`0.1 SOL 可买: ${pointOneSOLTokens.toFixed(5)} 个代币`);
        console.log("————————查询完成—————————");

        return {
            success: true,
            buyPrice,
            pointOneSOLTokens
        };
    } catch (error) {
        console.error('查询价格失败:', error.message);
        return { success: false, error: error.message };
    }
}

// 提交到 Jito
async function submitToJito(base58Transaction) {
    const url = "https://amsterdam.mainnet.block-engine.jito.wtf/api/v1/bundles";
    const data = {
        jsonrpc: "2.0",
        id: 1,
        method: "sendBundle",
        params: [[base58Transaction]]
    };
    const headers = { 'Content-Type': 'application/json' };

    const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(data)
    });

    return await response.json();
}

// 处理命令行参数
if (require.main === module) {
    const args = process.argv.slice(2);
    const command = args[0];
    const mintAddress = args[1];

    if (!command || !mintAddress) {
        console.log('请使用: npm run raydium buy <代币地址> <金额> 或 npm run raydium sell <代币地址> <百分比> 或 npm run raydium price <代币地址>');
        process.exit(1);
    }

    switch (command) {
        case 'price':
            getPrice(mintAddress);
            break;
        case 'buy':
            const buyAmount = args[2];
            if (!buyAmount) {
                console.log('请指定购买金额');
                process.exit(1);
            }
            buy(mintAddress, parseFloat(buyAmount));
            break;
        case 'sell':
            const sellPercent = args[2];
            if (!sellPercent) {
                console.log('请指定卖出百分比');
                process.exit(1);
            }
            sell(mintAddress, parseInt(sellPercent));
            break;
        default:
            console.log('无效命令。请使用 price、buy 或 sell');
            process.exit(1);
    }
}

module.exports = {
    buy,
    sell,
    getPrice
}; 