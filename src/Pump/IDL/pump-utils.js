require('dotenv').config();

const { PublicKey, Connection, Keypair, Transaction, LAMPORTS_PER_SOL, ComputeBudgetProgram, SystemProgram, VersionedTransaction, TransactionMessage } = require("@solana/web3.js");
const axios = require("axios");
const { PumpFunSDK } = require("./pump-sdk");
const { AnchorProvider, Wallet } = require("@coral-xyz/anchor");
const bs58 = require("bs58");

// 创建连接和SDK实例
const createConnection = (walletSecret) => {
    const wallet = Keypair.fromSecretKey(new Uint8Array(bs58.decode(walletSecret)));
    const connection = new Connection(process.env.RPC_URL, "confirmed");
    const provider = new AnchorProvider(connection, wallet, { commitment: "confirmed" });
    const sdk = new PumpFunSDK(provider);
    return { wallet, connection, sdk };
};

// 随机选择Jito小费账户
const getRandomJitoTipAccount = () => {
    const jitoTipAccounts = [
        "ADaUMid9yfUytqMBgopwjb2DTLSokTSzL1zt6iGPaS49",
        "DttWaMuVvTiduZRnguLF7jNxTgiMBZ1hyAumKUiL2KRL",
        "Cw8CFyM9FkoMi7K7Crf6HNQqf4uEMzpKw6QNghXLvLkY",
        "ADuUkR4vqLUMWXxW9gh6D6L8pMSawimctcNZ5pGwDcEt",
        "HFqU5x63VTqvQss8hp11i4wVV8bD44PvwucfZ2bU7gRe",
        "DfXygSm4jCyNCybVYYK6DwvWqjKee8pbDmJGcLWNDXjh",
        "3AVi9Tg9Uo68tJfuvoKvqKNWKkC5wPdSSdeBnizKZ6jT",
        "96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhvrZU5",
    ];
    return jitoTipAccounts[Math.floor(Math.random() * jitoTipAccounts.length)];
};

// 购买方法
async function pumpBuy(walletSecret, mintAddress, buyAmountSol, slippageBasisPoints = 500n) {
    try {
        const { wallet, connection, sdk } = createConnection(walletSecret);
        const mint = new PublicKey(mintAddress);

        // 获取绑定曲线账户信息来预估代币数量
        const bondingCurveAccount = await sdk.getBondingCurveAccount(mint);
        if (bondingCurveAccount) {
            const expectedTokens = bondingCurveAccount.getBuyPrice(BigInt(buyAmountSol * LAMPORTS_PER_SOL));
        }

        // 创建交易
        let newTx = new Transaction();
        
        // 获取购买指令
        const instruction = await sdk.getBuyInstructionsBySolAmount(
            wallet.publicKey,
            mint,
            BigInt(buyAmountSol * LAMPORTS_PER_SOL),
            BigInt(parseFloat(process.env.SLIPPAGE_PERCENT) * 100),
            'confirmed'
        );
        newTx.add(instruction);

        // 添加计算单元和优先费用指令
        const modifyComputeUnits = ComputeBudgetProgram.setComputeUnitLimit({ units: 1_000_000 });
        const addPriorityFee = ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 0.00001 * LAMPORTS_PER_SOL });
        newTx.add(modifyComputeUnits, addPriorityFee);

        // 添加Jito小费指令
        const randomJitoTipAccount = getRandomJitoTipAccount();
        const transferInstruction = SystemProgram.transfer({
            fromPubkey: wallet.publicKey,
            toPubkey: new PublicKey(randomJitoTipAccount),
            lamports: parseFloat(process.env.JITO_TIP_SOL) * LAMPORTS_PER_SOL,
        });
        newTx.add(transferInstruction);

        // 获取最新区块哈希并创建交易消息
        const blockhash = (await connection.getLatestBlockhash("confirmed")).blockhash;
        const messageV0 = new TransactionMessage({
            payerKey: wallet.publicKey,
            recentBlockhash: blockhash,
            instructions: newTx.instructions,
        }).compileToV0Message();

        // 创建并签名交易
        const transactionV0 = new VersionedTransaction(messageV0);
        transactionV0.sign([wallet]);

        // 提交到Jito
        const result = await submitToJito(transactionV0, wallet);
        return result;
    } catch (error) {
        console.error('pumpBuy 错误:', error);
        throw error;
    }
}

// 出售方法
async function pumpSell(walletSecret, mintAddress, sellAmount, slippageBasisPoints = 500n) {
    try {
        console.log('创建连接...');
        const { wallet, connection, sdk } = createConnection(walletSecret);
        const mint = new PublicKey(mintAddress);

        // 查询代币余额
        console.log('查询代币余额...');
        const tokenAccounts = await connection.getParsedTokenAccountsByOwner(
            wallet.publicKey,
            { programId: new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA') }
        );

        // 查找匹配的代币账户
        const matchingAccount = tokenAccounts.value.find(accountInfo => 
            new PublicKey(accountInfo.account.data.parsed.info.mint).equals(mint)
        );

        if (!matchingAccount) {
            throw new Error("没有找到匹配的代币账户");
        }

        const currentBalance = matchingAccount.account.data.parsed.info.tokenAmount.uiAmount;
        console.log('当前余额:', currentBalance);

        // 计算卖出数量
        const sellTokenAmount = BigInt(Math.round(currentBalance * 1e6 * (sellAmount / 100)));
        console.log('卖出数量:', Number(sellTokenAmount) / 1e6);

        // 获取预计获得的SOL
        const bondingCurveAccount = await sdk.getBondingCurveAccount(mint);
        if (bondingCurveAccount) {
            const expectedSol = Number(bondingCurveAccount.getSellPrice(sellTokenAmount, BigInt(0))) / LAMPORTS_PER_SOL;
            console.log('预计获得SOL:', expectedSol);
        }

        // 创建交易
        console.log('创建交易...');
        let newTx = new Transaction();
        
        // 获取出售指令
        console.log('获取出售指令...');
        const instruction = await sdk.getSellInstructionsByTokenAmount(
            wallet.publicKey,
            mint,
            sellTokenAmount,
            BigInt(parseFloat(process.env.SLIPPAGE_PERCENT) * 100),
            'confirmed'
        );
        newTx.add(instruction);

        // 添加计算单元和优先费用指令
        const modifyComputeUnits = ComputeBudgetProgram.setComputeUnitLimit({ units: 1_000_000 });
        const addPriorityFee = ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 0.00001 * LAMPORTS_PER_SOL });
        newTx.add(modifyComputeUnits, addPriorityFee);

        // 添加Jito小费指令
        const randomJitoTipAccount = getRandomJitoTipAccount();
        const transferInstruction = SystemProgram.transfer({
            fromPubkey: wallet.publicKey,
            toPubkey: new PublicKey(randomJitoTipAccount),
            lamports: parseFloat(process.env.JITO_TIP_SOL) * LAMPORTS_PER_SOL,
        });
        newTx.add(transferInstruction);

        // 获取最新区块哈希并创建交易消息
        const blockhash = (await connection.getLatestBlockhash("confirmed")).blockhash;
        const messageV0 = new TransactionMessage({
            payerKey: wallet.publicKey,
            recentBlockhash: blockhash,
            instructions: newTx.instructions,
        }).compileToV0Message();

        // 创建并签名交易
        const transactionV0 = new VersionedTransaction(messageV0);
        transactionV0.sign([wallet]);

        // 提交到Jito
        console.log('提交交易到 Jito...');
        const result = await submitToJito(transactionV0, wallet);
        console.log('Jito 返回结果:', result);
        
        return result;
    } catch (error) {
        console.error('pumpSell 错误:', error);
        throw error;
    }
}

// 百分比卖出方法 (percent 是 0-100 的数字)
async function pumpSellPercent(walletSecret, mintAddress, percent, slippageBasisPoints = 500n) {
    if (percent < 0 || percent > 100) {
        throw new Error("百分比必须在0-100之间");
    }

    const { wallet, connection, sdk } = createConnection(walletSecret);
    const mint = new PublicKey(mintAddress);

    // 查询代币余额
    const tokenAccounts = await connection.getParsedTokenAccountsByOwner(
        wallet.publicKey,
        { programId: new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA') }
    );

    // 查找匹配的代币账户
    const matchingAccount = tokenAccounts.value.find(accountInfo => 
        new PublicKey(accountInfo.account.data.parsed.info.mint).equals(mint)
    );

    if (!matchingAccount) {
        throw new Error("未找到该代币");
    }

    const balance = matchingAccount.account.data.parsed.info.tokenAmount.uiAmount;
    const sellAmount = balance * (percent / 100);

    // 获取绑定曲线账户信息来预估获得的SOL
    const bondingCurveAccount = await sdk.getBondingCurveAccount(mint);
    if (bondingCurveAccount) {
        const expectedSol = bondingCurveAccount.getSellPrice(BigInt(Math.round(sellAmount * 1e6)), BigInt(0));
    }

    // 创建交易
    let newTx = new Transaction();
    
    // 获取出售指令
    const instruction = await sdk.getSellInstructionsByTokenAmount(
        wallet.publicKey,
        mint,
        BigInt(Math.round(sellAmount * 1e6)),
        BigInt(parseFloat(process.env.SLIPPAGE_PERCENT) * 100),
        'confirmed'
    );
    newTx.add(instruction);

    // 添加计算单元和优先费用指令
    const modifyComputeUnits = ComputeBudgetProgram.setComputeUnitLimit({ units: 1_000_000 });
    const addPriorityFee = ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 0.00001 * LAMPORTS_PER_SOL });
    newTx.add(modifyComputeUnits, addPriorityFee);

    // 添加Jito小费指令
    const randomJitoTipAccount = getRandomJitoTipAccount();
    const transferInstruction = SystemProgram.transfer({
        fromPubkey: wallet.publicKey,
        toPubkey: new PublicKey(randomJitoTipAccount),
        lamports: 0.0001 * LAMPORTS_PER_SOL,
    });
    newTx.add(transferInstruction);

    // 获取最新区块哈希并创建交易消息
    const blockhash = (await connection.getLatestBlockhash("confirmed")).blockhash;
    const messageV0 = new TransactionMessage({
        payerKey: wallet.publicKey,
        recentBlockhash: blockhash,
        instructions: newTx.instructions,
    }).compileToV0Message();

    // 创建并签名交易
    const transactionV0 = new VersionedTransaction(messageV0);
    transactionV0.sign([wallet]);

    // 提交到Jito
    return await submitToJito(transactionV0, wallet);
}

// 提交交易到Jito
async function submitToJito(signedTransaction, wallet) {
    const jitoWallet = new Wallet(wallet);
    const signedTx = await jitoWallet.signTransaction(signedTransaction);
    
    const maxRetries = 3;
    let retryCount = 0;
    
    while (retryCount < maxRetries) {
        try {
            const serializedTransaction = signedTx.serialize();
            const base58Transaction = bs58.encode(serializedTransaction);
            
            const response = await axios.post(
                process.env.JITO_API_URL,
                {
                    jsonrpc: "2.0",
                    id: 1,
                    method: "sendTransaction",
                    params: [base58Transaction, { encoding: "base58" }]
                },
                {
                    headers: { 'Content-Type': 'application/json' },
                    timeout: 10000
                }
            );
            
            if (response.data.error) {
                throw new Error(response.data.error.message);
            }
            
            return response.data;
        } catch (error) {
            retryCount++;
            if (retryCount === maxRetries) {
                console.error("提交到 Jito 时出错:", error.message);
                throw error;
            }
            console.log(`提交失败,正在进行第${retryCount}次重试...`);
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
    }
}

module.exports = {
    pumpBuy,
    pumpSell,
    pumpSellPercent,
    createConnection
}; 