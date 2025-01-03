const colors = {
    reset: "\x1b[0m",
    bright: "\x1b[1m",
    dim: "\x1b[2m",
    green: "\x1b[32m",
    red: "\x1b[31m",
    yellow: "\x1b[33m"
};

const logger = {
    // 买入相关日志
    buyStart: () => console.log("—————————购买——————————"),
    buyEnd: () => console.log("————————购买完成—————————"),
    buyFail: () => console.log("————————购买失败—————————"),
    
    // 卖出相关日志
    sellStart: () => console.log("—————————卖出——————————"),
    sellEnd: () => console.log("————————卖出完成—————————"),
    sellFail: () => console.log("————————卖出失败—————————"),
    
    // 通用日志
    info: (msg) => console.log(msg),
    success: (msg) => console.log(`${colors.green}${msg}${colors.reset}`),
    error: (msg) => console.log(`${colors.red}${msg}${colors.reset}`),
    warn: (msg) => console.log(`${colors.yellow}${msg}${colors.reset}`),
    
    // 买入状态日志
    buyStatus: ({beforeBalance, buyAmount, expectedTokens, status, duration, afterBalance}) => {
        console.log(`买入前代币余额：${beforeBalance}`);
        console.log(`买入SOL金额：${buyAmount}`);
        if (expectedTokens) console.log(`预计买入数量：${expectedTokens}`);
        console.log(`提交状态：${status}`);
        if (status === '成功') {
            console.log("等待交易确认...");
            console.log(`上链耗时：${duration}ms`);
            console.log(`买入后代币余额：${afterBalance}`);
        }
    },
    
    // 卖出状态日志
    sellStatus: ({beforeSolBalance, currentBalance, sellAmount, percent, expectedSol, status, duration, afterSolBalance, profit}) => {
        console.log(`卖出前SOL余额：${beforeSolBalance}`);
        console.log(`当前代币余额：${currentBalance}`);
        console.log(`卖出数量：${sellAmount}（${percent}%）`);
        if (expectedSol) console.log(`预计获得SOL：${expectedSol}`);
        console.log(`提交状态：${status}`);
        if (status === '成功') {
            console.log("等待交易确认...");
            console.log(`上链耗时：${duration}ms`);
            console.log(`卖出后SOL余额：${afterSolBalance}`);
            console.log(`获得SOL：${profit}`);
        }
    }
};

module.exports = logger; 