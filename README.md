# 🚀 Meteora DLMM Arbitrage Bot

An advanced arbitrage bot that identifies and executes profitable trades between Meteora DLMM (Dynamic Liquidity Market Maker) pools and pumpswap price feed for Solana tokens.

## 📋 Overview

This bot continuously monitors Meteora DLMM pools for arbitrage opportunities by comparing pool prices with pumpswap  price feeds. It features dynamic profit thresholds, risk management, and automated trade execution.

## ✨ Features

- 🔍 **Multi-Pool Scanning**: Monitors all qualifying Meteora DLMM pools for the target token
- 📊 **Dynamic Profit Thresholds**: Adjusts buy/sell thresholds based on trading history
- 🛡️ **Risk Management**: SOL balance monitoring with sell-only mode protection
- ⚡ **Real-time Price Feeds**: Uses websocket connections for up-to-date pricing
- 🎯 **Smart Pool Filtering**: Filters pools by liquidity and fee criteria
- 📈 **Comprehensive Logging**: Detailed trading statistics and performance metrics
- 🔄 **Retry Logic**: Built-in error handling and transaction retry mechanisms

## 📁 File Structure

```
meteora-arbitrage-bot/
├── meteora-arbitrage_BOT007.js     # Main arbitrage bot
├── meteora-swap.js                 # Meteora DLMM swap client
├── pump_trades.py                  # Python price feed websocket
├── data/
│   └── pumpswap_price_data.json   # Price data storage
├── .env                           # Environment configuration
├── package.json                   # Node.js dependencies
└── README.md                      # This file
```

## 🛠️ Requirements

### Node.js Dependencies
- `@meteora-ag/dlmm`: Meteora DLMM SDK
- `@solana/web3.js`: Solana web3 library
- `@solana/spl-token`: SPL Token library
- `@coral-xyz/anchor`: Anchor framework
- `node-fetch`: HTTP requests
- `bs58`: Base58 encoding
- `dotenv`: Environment variables

### Python Dependencies
- `asyncio`: Async programming
- `websockets`: WebSocket client
- `json`: JSON handling

## 🚀 Installation

1. **Clone the repository**
```bash
git clone <your-repo-url>
cd meteora-arbitrage-bot
```

2. **Install Node.js dependencies**
```bash
npm install @meteora-ag/dlmm @solana/web3.js @solana/spl-token @coral-xyz/anchor node-fetch bs58 dotenv
```

3. **Install Python dependencies**
```bash
pip install asyncio websockets
```

4. **Create environment file**
```bash
cp .env.example .env
```

5. **Configure your settings** (see Configuration section)

## ⚙️ Configuration

### Environment Variables (.env)
```env
# Solana RPC endpoint
RPC_URL=https://your-rpc-endpoint.com

# Your wallet private key (base58 encoded)
PRIVATE_KEY=your_private_key_here

# API keys (if required)
PUMP_API_KEY=your_pump_api_key
```

### Bot Configuration (meteora-arbitrage_BOT007.js)
```javascript
this.config = {
    tokenMintX: "71Jvq4Epe2FCJ7JFSF7jLXdNk1Wy4Bhqd9iL6bEFELvg", // Target token
    tokenMintY: "So11111111111111111111111111111111111111112",  // SOL
    
    // Pool filtering
    minLiquiditySOL: 0.1,          // Minimum pool liquidity
    maxPoolFee: 4.0,               // Maximum pool fee %
    
    // Trading parameters
    baseProfitThreshold: 0.5,      // Base profit requirement %
    tradeAmountSOL: 0.01,          // Trade size in SOL
    minCooldownMs: 30000,          // Cooldown between trades
    
    // Risk management
    minSOLBalance: 0.05,           // Minimum SOL balance
    maxTradesPerHour: 100,         // Maximum trades per hour
}
```

## 🎮 Usage

### 1. Start the Price Feed
```bash
python pump_trades.py
```

### 2. Run the Arbitrage Bot
```bash
node meteora-arbitrage_BOT007.js
```

### 3. Monitor the Output
The bot will display:
- Pool scanning progress
- Arbitrage opportunities found
- Trade execution results
- Performance statistics

## 🔧 How It Works

### 1. Price Monitoring
- Python websocket connects to price feed APIs
- Saves real-time price data to JSON file
- Node.js bot reads this data for comparisons

### 2. Pool Scanning
- Fetches all Meteora DLMM pools for target token
- Filters pools by liquidity and fee criteria
- Gets current pool prices via Meteora SDK

### 3. Arbitrage Detection
- Compares pool prices with external feed prices
- Calculates profit potential after fees and slippage
- Applies dynamic profit thresholds

### 4. Trade Execution
- Creates optimized swap transactions
- Handles bin array calculations for DLMM
- Executes trades with proper slippage protection

### 5. Risk Management
- Monitors SOL balance for transaction fees
- Switches to sell-only mode when balance is low
- Implements cooldowns and trade limits

## 📊 Bot Logic

### Dynamic Profit Thresholds
- **Buy Trades**: `Base Threshold + (Net Buy Trades × 0.2%)`
- **Sell Trades**: Always use base threshold
- Encourages balanced trading behavior

### Pool Price Calculation
```javascript
// Pool price extraction with scaling
const rawPrice = poolInfo.activeBin.price;
const adjustedPrice = rawPrice / 1000; // Scaling factor for SPX
```

### Trade Amount Calculation
```javascript
// For sell trades
const tokenAmount = (tradeAmountSOL / poolPrice) * 1e6; // 6 decimals for SPX
const minAmountOut = expectedSOL * (1 - slippage);
```

## 📈 Performance Metrics

The bot tracks:
- Total trades executed
- Success rate
- Buy vs sell trade ratio
- Net profit/loss
- Pool scanning efficiency
- SOL balance management

## 🐛 Troubleshooting

### Common Issues

**1. "Price data too old" Error**
- Ensure Python price feed is running
- Check websocket connection
- Verify file permissions for data directory

**2. "pubkey.toBase58 is not a function" Error**
- Update to latest Meteora SDK version
- Check bin array format compatibility
- Verify PublicKey object creation

**3. "Insufficient SOL balance" Error**
- Deposit more SOL to wallet
- Reduce trade amounts
- Check minimum balance settings

**4. High Price Impact Warnings**
- Reduce trade size
- Check pool liquidity
- Verify price scaling factors

### Debug Mode
Enable detailed logging by setting:
```javascript
console.log('🔍 Debug mode enabled');
```

## ⚠️ Risk Disclaimer

This bot involves financial transactions and carries inherent risks:

- **Market Risk**: Cryptocurrency prices are volatile
- **Smart Contract Risk**: DeFi protocols may have bugs
- **Impermanent Loss**: Pool mechanics may cause losses
- **Technical Risk**: Bot errors may result in losses

**Use at your own risk. Never invest more than you can afford to lose.**

## 📜 License

This project is provided for educational purposes. Users are responsible for complying with all applicable laws and regulations.

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## 📞 Support

For issues and questions:
- Open a GitHub issue
- Check the troubleshooting section
- Review the Meteora documentation

## 🔗 Useful Links

- [Meteora DLMM Documentation](https://docs.meteora.ag/)
- [Solana Web3.js Documentation](https://docs.solana.com/developing/clients/javascript-api)
- [Solana Explorer](https://explorer.solana.com/)

---

**⚡ Happy Trading! ⚡**

*Remember: This bot is for educational purposes. Always do your own research and trade responsibly.*
