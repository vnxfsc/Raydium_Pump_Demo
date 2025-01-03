const {  PublicKey, Transaction } = require("@solana/web3.js");

const { struct, bool, u64, publicKey } = require("@coral-xyz/borsh");

const { Program } = require("@coral-xyz/anchor");

const { createAssociatedTokenAccountInstruction, getAccount, getAssociatedTokenAddress } = require("@solana/spl-token");

const BN = require("bn.js");

const IDL = require("./pump-fun.json");

const PROGRAM_ID = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P";

const GLOBAL_ACCOUNT_SEED = "global";
const BONDING_CURVE_SEED = "bonding-curve";

const DEFAULT_DECIMALS = 6;

class PumpFunSDK {
  constructor(provider) {
    this.program = new Program(IDL, provider); // 使用 Anchor 库初始化程序
    this.connection = this.program.provider.connection; // 获取连接对象
  }
  
  // 获取购买指令
  async getBuyInstructionsBySolAmount(buyer, mint, buyAmountSol, slippageBasisPoints = 500n, commitment = DEFAULT_COMMITMENT) {
    let bondingCurveAccount = await this.getBondingCurveAccount(mint, commitment);
    if (!bondingCurveAccount) {
      throw new Error(`未找到绑定曲线账户: ${mint.toBase58()}`);
    }

    let buyAmount = bondingCurveAccount.getBuyPrice(buyAmountSol); // 获取购买价格
    let buyAmountWithSlippage = calculateWithSlippageBuy(buyAmountSol, slippageBasisPoints); // 计算带有滑点的购买金额

    let globalAccount = await this.getGlobalAccount(commitment); // 获取全局账户信息

    return await this.getBuyInstructions(buyer, mint, globalAccount.feeRecipient, buyAmount, buyAmountWithSlippage); // 获取购买指令
  }

  // 获取购买指令
  async getBuyInstructions(buyer, mint, feeRecipient, amount, solAmount, commitment = DEFAULT_COMMITMENT) {
    const associatedBondingCurve = await getAssociatedTokenAddress(mint, this.getBondingCurvePDA(mint), true); // 获取绑定曲线账户地址

    const associatedUser = await getAssociatedTokenAddress(mint, buyer, false); // 获取用户的代币账户地址

    let transaction = new Transaction();

    try {
      await getAccount(this.connection, associatedUser, commitment);
    } catch (e) {
      transaction.add(createAssociatedTokenAccountInstruction(buyer, associatedUser, buyer, mint)); // 如果账户不存在，添加创建账户的指令
    }

    transaction.add(
      await this.program.methods
        .buy(new BN(amount.toString()), new BN(solAmount.toString()))
        .accounts({
          feeRecipient: feeRecipient,
          mint: mint,
          associatedBondingCurve: associatedBondingCurve,
          associatedUser: associatedUser,
          user: buyer,
        })
        .transaction(),
    );

    return transaction;
  }

  // 获取出售指令
  async getSellInstructionsByTokenAmount(seller, mint, sellTokenAmount, slippageBasisPoints = 500n, commitment = DEFAULT_COMMITMENT) {
    let bondingCurveAccount = await this.getBondingCurveAccount(mint, commitment);
    if (!bondingCurveAccount) {
      throw new Error(`未找到绑定曲线账户: ${mint.toBase58()}`);
    }

    let globalAccount = await this.getGlobalAccount(commitment);

    let minSolOutput = bondingCurveAccount.getSellPrice(sellTokenAmount, globalAccount.feeBasisPoints);

    let sellAmountWithSlippage = calculateWithSlippageSell(minSolOutput, slippageBasisPoints);

    return await this.getSellInstructions(seller, mint, globalAccount.feeRecipient, sellTokenAmount, sellAmountWithSlippage);
  }
  // 获取出售指令
  async getSellInstructions(seller, mint, feeRecipient, amount, minSolOutput) {
    const associatedBondingCurve = await getAssociatedTokenAddress(mint, this.getBondingCurvePDA(mint), true);

    const associatedUser = await getAssociatedTokenAddress(mint, seller, false);

    let transaction = new Transaction();

    transaction.add(
      await this.program.methods
        .sell(new BN(amount.toString()), new BN(minSolOutput.toString()))
        .accounts({
          feeRecipient: feeRecipient,
          mint: mint,
          associatedBondingCurve: associatedBondingCurve,
          associatedUser: associatedUser,
          user: seller,
        })
        .transaction(),
    );

    return transaction;
  }
  // 获取绑定曲线账户信息
  async getBondingCurveAccount(mint, commitment = DEFAULT_COMMITMENT) {
    const tokenAccount = await this.connection.getAccountInfo(this.getBondingCurvePDA(mint), commitment);
    if (!tokenAccount) {
      return null;
    }
    return BondingCurveAccount.fromBuffer(tokenAccount.data);
  }
  // 获取全局账户信息
  async getGlobalAccount(commitment = DEFAULT_COMMITMENT) {
    const [globalAccountPDA] = PublicKey.findProgramAddressSync([Buffer.from(GLOBAL_ACCOUNT_SEED)], new PublicKey(PROGRAM_ID));

    const tokenAccount = await this.connection.getAccountInfo(globalAccountPDA, commitment);

    return GlobalAccount.fromBuffer(tokenAccount.data);
  }

  getBondingCurvePDA(mint) {
    return PublicKey.findProgramAddressSync([Buffer.from(BONDING_CURVE_SEED), mint.toBuffer()], this.program.programId)[0];
  }
  // 获取绑定曲线账户地址
  removeEventListener(eventId) {
    this.program.removeEventListener(eventId);
  }
}

const DEFAULT_COMMITMENT = "finalized";
// 计算购买时的滑点
const calculateWithSlippageBuy = (amount, basisPoints) => {
  return amount + (amount * basisPoints) / 10000n;
};
// 计算出售时的滑点
const calculateWithSlippageSell = (amount, basisPoints) => {
  return amount - (amount * basisPoints) / 10000n;
};
// 获取模拟的gas费
class GlobalAccount {
  initialized = false;

  constructor(discriminator, initialized, authority, feeRecipient, initialVirtualTokenReserves, initialVirtualSolReserves, initialRealTokenReserves, tokenTotalSupply, feeBasisPoints) {
    this.discriminator = discriminator;
    this.initialized = initialized;
    this.authority = authority;
    this.feeRecipient = feeRecipient;
    this.initialVirtualTokenReserves = initialVirtualTokenReserves;
    this.initialVirtualSolReserves = initialVirtualSolReserves;
    this.initialRealTokenReserves = initialRealTokenReserves;
    this.tokenTotalSupply = tokenTotalSupply;
    this.feeBasisPoints = feeBasisPoints;
  }

  getInitialBuyPrice(amount) {
    if (amount <= 0n) {
      return 0n;
    }

    let n = this.initialVirtualSolReserves * this.initialVirtualTokenReserves;
    let i = this.initialVirtualSolReserves + amount;
    let r = n / i + 1n;
    let s = this.initialVirtualTokenReserves - r;
    return s < this.initialRealTokenReserves ? s : this.initialRealTokenReserves;
  }

  static fromBuffer(buffer) {
    const structure = struct([u64("discriminator"), bool("initialized"), publicKey("authority"), publicKey("feeRecipient"), u64("initialVirtualTokenReserves"), u64("initialVirtualSolReserves"), u64("initialRealTokenReserves"), u64("tokenTotalSupply"), u64("feeBasisPoints")]);

    let value = structure.decode(buffer);
    return new GlobalAccount(BigInt(value.discriminator), value.initialized, value.authority, value.feeRecipient, BigInt(value.initialVirtualTokenReserves), BigInt(value.initialVirtualSolReserves), BigInt(value.initialRealTokenReserves), BigInt(value.tokenTotalSupply), BigInt(value.feeBasisPoints));
  }
}

class BondingCurveAccount {
  constructor(discriminator, virtualTokenReserves, virtualSolReserves, realTokenReserves, realSolReserves, tokenTotalSupply, complete) {
    this.discriminator = discriminator;
    this.virtualTokenReserves = virtualTokenReserves;
    this.virtualSolReserves = virtualSolReserves;
    this.realTokenReserves = realTokenReserves;
    this.realSolReserves = realSolReserves;
    this.tokenTotalSupply = tokenTotalSupply;
    this.complete = complete;
  }
  // 获取购买价格
  getBuyPrice(amount) {
    if (this.complete) {
      throw new Error("曲线已完成");
    }

    if (amount <= 0n) {
      return 0n;
    }

    // 计算虚拟储备的乘积
    let n = this.virtualSolReserves * this.virtualTokenReserves;

    // 计算购买后的新虚拟Sol储备
    let i = this.virtualSolReserves + amount;

    // 计算购买后的新虚拟Token储备
    let r = n / i + 1n;

    // 计算要购买的Token数量
    let s = this.virtualTokenReserves - r;

    // 返回计算的Token数量和实际Token储备中的最小值
    return s < this.realTokenReserves ? s : this.realTokenReserves;
  }
  // 获取出售价格
  getSellPrice(amount, feeBasisPoints) {
    if (this.complete) {
      throw new Error("曲线已完成");
    }

    if (amount <= 0n) {
      return 0n;
    }

    // 计算要接收的虚拟Sol储备的比例
    let n = (amount * this.virtualSolReserves) / (this.virtualTokenReserves + amount);

    // 计算费用金额
    let a = (n * feeBasisPoints) / 10000n;

    // 返回扣除费用后的净金额
    return n - a;
  }
  // 获取市场总市值（以SOL为单位）
  getMarketCapSOL() {
    if (this.virtualTokenReserves === 0n) {
      return 0n;
    }
    // 计算市场总市值
    return (this.tokenTotalSupply * this.virtualSolReserves) / this.virtualTokenReserves;
  }
  // 获取最终市场市值（考虑费用后）
  getFinalMarketCapSOL(feeBasisPoints) {
    let totalSellValue = this.getBuyOutPrice(this.realTokenReserves, feeBasisPoints);
    let totalVirtualValue = this.virtualSolReserves + totalSellValue;
    let totalVirtualTokens = this.virtualTokenReserves - this.realTokenReserves;

    if (totalVirtualTokens === 0n) {
      return 0n;
    }
    // 计算最终市场市值
    return (this.tokenTotalSupply * totalVirtualValue) / totalVirtualTokens;
  }
  // 获取出售所有Token后的价格（考虑费用）
  getBuyOutPrice(amount, feeBasisPoints) {
    let solTokens = amount < this.realSolReserves ? this.realSolReserves : amount;
    let totalSellValue = (solTokens * this.virtualSolReserves) / (this.virtualTokenReserves - solTokens) + 1n;
    let fee = (totalSellValue * feeBasisPoints) / 10000n;
    return totalSellValue + fee;
  }
  // 从Buffer中解析数据
  static fromBuffer(buffer) {
    const structure = struct([u64("discriminator"), u64("virtualTokenReserves"), u64("virtualSolReserves"), u64("realTokenReserves"), u64("realSolReserves"), u64("tokenTotalSupply"), bool("complete")]);

    let value = structure.decode(buffer);
    return new BondingCurveAccount(BigInt(value.discriminator), BigInt(value.virtualTokenReserves), BigInt(value.virtualSolReserves), BigInt(value.realTokenReserves), BigInt(value.realSolReserves), BigInt(value.tokenTotalSupply), value.complete);
  }
}

module.exports = {
  PumpFunSDK,
  DEFAULT_DECIMALS,
};
