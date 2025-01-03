const axios = require('axios');
const { Liquidity, LIQUIDITY_STATE_LAYOUT_V4, MARKET_STATE_LAYOUT_V3, SPL_MINT_LAYOUT, Market } = require('@raydium-io/raydium-sdk');
const { NATIVE_MINT } = require('@solana/spl-token');
const { Connection, PublicKey } = require('@solana/web3.js');

async function formatAmmKeysById(id, connection) {
    try {
        const account = await connection.getAccountInfo(new PublicKey(id));
        const info = LIQUIDITY_STATE_LAYOUT_V4.decode(account.data);

        const marketId = info.marketId;
        const marketAccount = await connection.getAccountInfo(marketId);
        const marketInfo = MARKET_STATE_LAYOUT_V3.decode(marketAccount.data);

        const lpMint = info.lpMint;
        const lpMintAccount = await connection.getAccountInfo(lpMint);
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
    } catch (err) {
        console.error('格式化 AMM 池信息时发生错误:', err.message || err);
        throw err;
    }
}


// 获取池信息
async function getPoolKeys(baseMint, connection) {
    try {
        const res = await axios.get(`https://api.dexscreener.com/latest/dex/tokens/${baseMint.toBase58()}`, {
            headers: {
                Accept: 'application/json',
                'Content-Type': 'application/json',
            },
            timeout: 10000,
        });

        const data = res.data;
        if (!data.pairs || data.pairs.length === 0) {
            return null;
        }
        const raydiumPair = data.pairs.find(
            (pair) => pair.dexId === 'raydium' && pair.quoteToken.address === NATIVE_MINT.toBase58()
        );

        if (!raydiumPair) {
            return null;
        }

        const raydiumPairId = raydiumPair.pairAddress;
        const poolState = await formatAmmKeysById(raydiumPairId, connection);
        return poolState;
    } catch (e) {
        console.error('获取Raydium池配对发生错误:', e.message || e);
        return null;
    }
}

module.exports = { getPoolKeys, formatAmmKeysById };