const { jsonInfo2PoolKeys, Liquidity, LiquidityPoolKeys, Percent, Token, TokenAmount, ApiPoolInfoV4, LIQUIDITY_STATE_LAYOUT_V4, MARKET_STATE_LAYOUT_V3, Market, SPL_MINT_LAYOUT, SPL_ACCOUNT_LAYOUT, TokenAccount, TxVersion, buildSimpleTransaction, LOOKUP_TABLE_CACHE, } = require('@raydium-io/raydium-sdk');

const { PublicKey, Keypair, SystemProgram, VersionedTransaction, LAMPORTS_PER_SOL } = require('@solana/web3.js');

const { TOKEN_PROGRAM_ID, getAssociatedTokenAddress, getMint } = require('@solana/spl-token');

async function getWalletTokenAccount(connection, wallet) {

    // 创建 Token 实例用去sol跟wsol
    const walletTokenAccount = await connection.getTokenAccountsByOwner(wallet, {
        programId: TOKEN_PROGRAM_ID,
    });
    return walletTokenAccount.value.map((i) => ({
        pubkey: i.pubkey,
        programId: i.account.owner,
        accountInfo: SPL_ACCOUNT_LAYOUT.decode(i.account.data),
    }));
}

async function swapOnlyAmm(connection, input) {
    const targetPoolInfo = await formatAmmKeysById(connection, input.targetPool);
    const poolKeys = jsonInfo2PoolKeys(targetPoolInfo);

    // 计算输出金额
    const { amountOut, minAmountOut } = Liquidity.computeAmountOut({
        poolKeys: poolKeys,
        poolInfo: await Liquidity.fetchInfo({ connection, poolKeys }),
        amountIn: input.inputTokenAmount,
        currencyOut: input.outputToken,
        slippage: input.slippage,
    });
    const { innerTransactions } = await Liquidity.makeSwapInstructionSimple({
        connection,
        poolKeys,
        userKeys: {
            tokenAccounts: input.walletTokenAccounts,
            owner: input.wallet.publicKey,
        },
        amountIn: input.inputTokenAmount,
        amountOut: minAmountOut,
        fixedSide: 'in',
        makeTxVersion: TxVersion.V0,
        computeBudgetConfig: {
            microLamports: 0.00001 * LAMPORTS_PER_SOL,
            units: 100_000,
        },
    });

    return innerTransactions;
}

async function formatAmmKeysById(connection, id) {
    const account = await connection.getAccountInfo(new PublicKey(id));
    if (account === null) throw new Error('获取 ID 信息错误');
    const info = LIQUIDITY_STATE_LAYOUT_V4.decode(account.data);

    const marketId = info.marketId;
    const marketAccount = await connection.getAccountInfo(marketId);
    if (marketAccount === null) throw new Error('获取市场信息错误');
    const marketInfo = MARKET_STATE_LAYOUT_V3.decode(marketAccount.data);

    const lpMint = info.lpMint;
    const lpMintAccount = await connection.getAccountInfo(lpMint);
    if (lpMintAccount === null) throw new Error('获取 LP mint 信息错误');
    const lpMintInfo = SPL_MINT_LAYOUT.decode(lpMintAccount.data);

    return {
        id,
        baseMint: info.baseMint.toString(),
        quoteMint: info.quoteMint.toString(),
        lpMint: info.lpMint.toString(),
        baseDecimals: info.baseDecimal.toNumber(),
        quoteDecimals: info.quoteDecimal.toNumber(),
        lpDecimals: lpMintInfo.decimals,
        version: 4,
        programId: account.owner.toString(),
        authority: Liquidity.getAssociatedAuthority({ programId: account.owner }).publicKey.toString(),
        openOrders: info.openOrders.toString(),
        targetOrders: info.targetOrders.toString(),
        baseVault: info.baseVault.toString(),
        quoteVault: info.quoteVault.toString(),
        withdrawQueue: info.withdrawQueue.toString(),
        lpVault: info.lpVault.toString(),
        marketVersion: 3,
        marketProgramId: info.marketProgramId.toString(),
        marketId: info.marketId.toString(),
        marketAuthority: Market.getAssociatedAuthority({
            programId: info.marketProgramId,
            marketId: info.marketId,
        }).publicKey.toString(),
        marketBaseVault: marketInfo.baseVault.toString(),
        marketQuoteVault: marketInfo.quoteVault.toString(),
        marketBids: marketInfo.bids.toString(),
        marketAsks: marketInfo.asks.toString(),
        marketEventQueue: marketInfo.eventQueue.toString(),
        lookupTableAccount: PublicKey.default.toString(),
    };
}


async function getBuyTx(connection, wallet, baseMint, quoteMint, amount, targetPool, slippages) {
    try {
        const baseInfo = await getMint(connection, baseMint);
        if (baseInfo == null) {
            return null;
        }
        const baseDecimal = baseInfo.decimals;

        const baseToken = new Token(TOKEN_PROGRAM_ID, baseMint, baseDecimal);
        const quoteToken = new Token(TOKEN_PROGRAM_ID, quoteMint, 9);

        const quoteTokenAmount = new TokenAmount(quoteToken, Math.floor(amount * 10 ** 9));
        const walletTokenAccounts = await getWalletTokenAccount(connection, wallet.publicKey);

        const slippage = new Percent(slippages, 100);
        const instructions = await swapOnlyAmm(connection, {
            outputToken: baseToken,
            targetPool,
            inputTokenAmount: quoteTokenAmount,
            slippage,
            walletTokenAccounts,
            wallet: wallet,
        });

        // 添加小费转账指令
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

        const randomIndex = Math.floor(Math.random() * jitoTipAccounts.length);
        const randomJitoTipAccount = jitoTipAccounts[randomIndex];

        const transferInstruction = SystemProgram.transfer({
            fromPubkey: wallet.publicKey,
            toPubkey: new PublicKey(randomJitoTipAccount),
            lamports: 0.0001 * LAMPORTS_PER_SOL,
        });

        instructions[0].instructions.push(transferInstruction);

        const latestBlockhash = await connection.getLatestBlockhash();
        const willSendTx = (
            await buildSimpleTransaction({
                connection: connection,
                makeTxVersion: TxVersion.V0,
                payer: wallet.publicKey,
                innerTransactions: instructions,
                addLookupTableInfo: LOOKUP_TABLE_CACHE,
                blockhash: latestBlockhash.blockhash,
            })
        )[0];

        if (willSendTx instanceof VersionedTransaction) {
            willSendTx.sign([wallet]);
            return willSendTx;
        }

        return null;
    } catch (e) {
        console.error('getBuyTx 发生错误:', e);
        return null;
    }
}

async function getSellTx(connection, wallet, baseMint, quoteMint, amount, targetPool, slippages) {
    try {
        // 获取基础代币的Token账户
        const tokenAta = await getAssociatedTokenAddress(baseMint, wallet.publicKey);
        const tokenBal = await connection.getTokenAccountBalance(tokenAta);

        // 检查账户余额
        if (!tokenBal || tokenBal.value.uiAmount === 0) return null;
        const decimals = tokenBal.value.decimals;
        
        const baseToken = new Token(TOKEN_PROGRAM_ID, baseMint, decimals);
        const quoteToken = new Token(TOKEN_PROGRAM_ID, quoteMint, 9);
        const baseTokenAmount = new TokenAmount(baseToken, amount);

        const slippage = new Percent(slippages, 100);
        const walletTokenAccounts = await getWalletTokenAccount(connection, wallet.publicKey);

        const instructions = await swapOnlyAmm(connection, {
            outputToken: quoteToken,
            targetPool,
            inputTokenAmount: baseTokenAmount,
            slippage,
            walletTokenAccounts,
            wallet: wallet,
        });

        // 添加小费转账指令
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

        const randomIndex = Math.floor(Math.random() * jitoTipAccounts.length);
        const randomJitoTipAccount = jitoTipAccounts[randomIndex];

        const transferInstruction = SystemProgram.transfer({
            fromPubkey: wallet.publicKey,
            toPubkey: new PublicKey(randomJitoTipAccount),
            lamports: 0.0001 * LAMPORTS_PER_SOL,
        });

        instructions[0].instructions.push(transferInstruction);

        const latestBlockhash = await connection.getLatestBlockhash();
        const willSendTx = (
            await buildSimpleTransaction({
                connection: connection,
                makeTxVersion: TxVersion.V0,
                payer: wallet.publicKey,
                innerTransactions: instructions,
                addLookupTableInfo: LOOKUP_TABLE_CACHE,
                blockhash: latestBlockhash.blockhash,
            })
        )[0];

        if (willSendTx instanceof VersionedTransaction) {
            willSendTx.sign([wallet]);
            return willSendTx;
        }

        return null;
    } catch (error) {
        console.log('卖出代币时发生错误', error);
        return null;
    }
}

module.exports = { getBuyTx, getSellTx };