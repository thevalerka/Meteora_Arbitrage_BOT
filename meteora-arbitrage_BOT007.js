// meteora-arbitrage2.js
// Enhanced arbitrage bot that scans all SPX-SOL pools from Meteora API

import { MeteoraDLMMSwap } from './meteora-swap.js';
import fs from 'fs/promises';
import fetch from 'node-fetch';
import dotenv from 'dotenv';

dotenv.config();

class EnhancedMeteoraDLMMArbitrage {
    constructor(rpcUrl, privateKey) {
        this.swapClient = new MeteoraDLMMSwap(rpcUrl, privateKey);
        this.isRunning = false;
        this.lastTradeTime = 0;
        this.tradeCount = 0;
        this.poolCache = [];
        this.lastPoolUpdate = 0;
        this.currentSOLBalance = 0;
        this.sellOnlyMode = false;

        // Configuration
        this.config = {
            tokenMintX: "71Jvq4Epe2FCJ7JFSF7jLXdNk1Wy4Bhqd9iL6bEFELvg", // SPX
            tokenMintY: "So11111111111111111111111111111111111111112",  // SOL
            jupiterPriceFile: "/home/ubuntu/009_MM_BOTS/bot007_MeteoraPUMPFUN/data/pumpswap_price_data.json",
            meteoraApiUrl: "https://dlmm-api.meteora.ag/pair/all_by_groups?include_token_mints=71Jvq4Epe2FCJ7JFSF7jLXdNk1Wy4Bhqd9iL6bEFELvg",

            // Pool filtering
            minLiquiditySOL: .1,           // Minimum 1 SOL liquidity
            maxPoolFee: 4.0,                // Skip pools with fees > 2%

            // Arbitrage settings
            baseProfitThreshold: 0.5,       // Base 1% profit requirement
            profitThresholdIncrement: 0.2,  // 0.1% increment per net BUY trade
            tradeAmountSOL: 0.01,           // 0.01 SOL per trade
            minCooldownMs: 30000,           // 30 seconds between trades
            maxTradesPerHour: 100,           // Increased for multi-pool

            // SOL balance management
            minSOLBalance: 0.05,             // Minimum SOL balance threshold
            reserveSOLForFees: 0.02,        // Reserve additional SOL for transaction fees

            // Monitoring settings
            checkIntervalMs: 10000,         // Check every 30 seconds (was 5 seconds)
            maxPriceAgeMs: 60000,           // Max 60 seconds old price data
            poolCacheMs: 600000,            // Update pool cache every 10 minutes (was 5 minutes)
        };

        this.stats = {
            totalTrades: 0,
            successfulTrades: 0,
            buyTrades: 0,
            sellTrades: 0,
            netBuyTrades: 0,            // Track net BUY trades for threshold calculation
            totalProfit: 0,
            poolsScanned: 0,
            bestOpportunities: [],
            sellOnlyPeriods: 0,
            startTime: Date.now()
        };
    }

    async checkSOLBalance() {
        try {
            // Get SOL balance using the connection from swap client
            const connection = this.swapClient.connection;
            const publicKey = this.swapClient.wallet.publicKey;

            // Get balance in lamports and convert to SOL
            const balanceLamports = await connection.getBalance(publicKey);
            const balance = balanceLamports / 1e9; // Convert lamports to SOL

            this.currentSOLBalance = balance;

            const wasInSellOnlyMode = this.sellOnlyMode;
            this.sellOnlyMode = balance < this.config.minSOLBalance;

            // Log balance status changes
            if (!wasInSellOnlyMode && this.sellOnlyMode) {
                console.log(`🚨 SOL Balance Alert: ${balance.toFixed(6)} SOL < ${this.config.minSOLBalance} SOL`);
                console.log(`🔒 Switching to SELL-ONLY mode to preserve SOL for fees`);
                this.stats.sellOnlyPeriods++;
            } else if (wasInSellOnlyMode && !this.sellOnlyMode) {
                console.log(`✅ SOL Balance Restored: ${balance.toFixed(6)} SOL >= ${this.config.minSOLBalance} SOL`);
                console.log(`🔓 Resuming normal BUY/SELL operations`);
            }

            // Always log current balance status
            const modeText = this.sellOnlyMode ? '🔒 SELL-ONLY' : '🔓 BUY/SELL';
            console.log(`💰 Current SOL Balance: ${balance.toFixed(6)} SOL (${modeText} mode)`);

            return balance;

        } catch (error) {
            console.error('❌ Error checking SOL balance:', error.message);
            // On error, assume low balance for safety
            this.sellOnlyMode = true;
            return 0;
        }
    }

    calculateDynamicProfitThreshold(isBuyTrade = true) {
        if (!isBuyTrade) {
            // For SELL trades, always use base threshold
            return this.config.baseProfitThreshold;
        }

        // For BUY trades, use dynamic threshold based on net BUY trades
        // Formula: baseProfitThreshold + (netBuyTrades * increment), but never lower than base
        const dynamicThreshold = this.config.baseProfitThreshold +
            (this.stats.netBuyTrades * this.config.profitThresholdIncrement);

        return Math.max(dynamicThreshold, this.config.baseProfitThreshold);
    }
  async loadJupiterPrices() {
        try {
            const data = await fs.readFile(this.config.jupiterPriceFile, 'utf8');
            const priceData = JSON.parse(data);
            console.log(priceData)

            const fetchTime = new Date(priceData.fetch_timestamp);
            const ageMs = Date.now() - fetchTime.getTime();

            if (ageMs > this.config.maxPriceAgeMs) {
                throw new Error(`Price data too old: ${ageMs}ms (max: ${this.config.maxPriceAgeMs}ms)`);
            }

            const hositcoPrice = parseFloat(priceData.data[this.config.tokenMintX]?.price);
            const solPrice = 1;

            if (!hositcoPrice || !solPrice) {
                throw new Error('Missing price data for tokens');
            }

            const jupiterPrice = hositcoPrice / solPrice;

            return {
                hositcoUSD: hositcoPrice,
                solUSD: solPrice,
                hositcoInSOL: jupiterPrice,
                timestamp: fetchTime,
                ageMs: ageMs
            };

        } catch (error) {
            console.error('❌ Error loading Jupiter prices:', error.message);
            return null;
        }
    }

    async fetchMeteoraPoolData() {
        try {
            console.log('🔍 Fetching Meteora pool data...');
            const response = await fetch(this.config.meteoraApiUrl);

            if (!response.ok) {
                throw new Error(`API request failed: ${response.status}`);
            }

            const data = await response.json();

            if (!data.groups || !data.groups[0] || !data.groups[0].pairs) {
                throw new Error('Invalid API response structure');
            }

            const pools = data.groups[0].pairs;
            console.log(`📊 Found ${pools.length} TOKEN-SOL pools`);

            // Filter pools by liquidity and fees
            const filteredPools = pools.filter(pool => {
                const liquiditySOL = parseFloat(pool.reserve_y_amount) / 1e9;
                const baseFee = parseFloat(pool.base_fee_percentage);

                const meetsLiquidity = liquiditySOL >= this.config.minLiquiditySOL;
                const meetsFeeCriteria = baseFee <= this.config.maxPoolFee;

                if (!meetsLiquidity) {
                    console.log(`⚠️ Skipping ${pool.address}: Low liquidity (${liquiditySOL.toFixed(2)} SOL)`);
                }
                if (!meetsFeeCriteria) {
                    console.log(`⚠️ Skipping ${pool.address}: High fees (${baseFee}%)`);
                }

                return meetsLiquidity && meetsFeeCriteria;
            });

            console.log(`✅ ${filteredPools.length} pools meet criteria (>= ${this.config.minLiquiditySOL} SOL liquidity, <= ${this.config.maxPoolFee}% fees)`);

            // Enhance pool data with calculated metrics
            const enhancedPools = filteredPools.map(pool => ({
                ...pool,
                liquiditySOL: parseFloat(pool.reserve_y_amount) / 1e9,
                liquidityUSD: (parseFloat(pool.reserve_y_amount) / 1e9) * 200, // Approximate SOL price
                baseFeePercent: parseFloat(pool.base_fee_percentage),
                maxFeePercent: parseFloat(pool.max_fee_percentage),
                // Note: profitThreshold will be calculated dynamically per opportunity
            }));

            this.poolCache = enhancedPools;
            this.lastPoolUpdate = Date.now();

            return enhancedPools;

        } catch (error) {
            console.error('❌ Error fetching Meteora pools:', error.message);
            return this.poolCache; // Return cached data if available
        }
    }

    async getPoolPrice(poolAddress) {
          try {
              const poolInfo = await this.swapClient.getPoolInfo(poolAddress);

              // Get the raw price from the active bin
              const rawPrice = parseFloat(poolInfo.activeBin.price);

              // The price returned by Meteora is usually already in the correct format
              // For SPX/SOL pools, this should be the price of SPX in terms of SOL
              // No manual decimal adjustment needed in most cases

              // Log for debugging
              console.log(`📊 Raw pool price: ${rawPrice}`);
              console.log(`📊 Token X decimals: ${poolInfo.tokenX.decimals}`);
              console.log(`📊 Token Y decimals: ${poolInfo.tokenY.decimals}`);

              // If price seems too high (> 1 SOL per SPX), apply scaling
              let adjustedPrice = rawPrice;
              if (rawPrice > 1) {
                  // Try different scaling factors based on decimal differences
                  const decimalDiff = poolInfo.tokenX.decimals - poolInfo.tokenY.decimals;
                  if (decimalDiff !== 0) {
                      adjustedPrice = rawPrice / Math.pow(10, Math.abs(decimalDiff));
                      console.log(`📊 Applied decimal scaling (${decimalDiff}): ${adjustedPrice}`);
                  }

                  // If still too high, try the /1000 scaling you had before
                  if (adjustedPrice > 1) {
                      adjustedPrice = rawPrice / 1000;
                      console.log(`📊 Applied /1000 scaling: ${adjustedPrice}`);
                  }
              }

              return {
                  hositcoInSOL: adjustedPrice,
                  binId: poolInfo.activeBin.binId,
                  timestamp: new Date(),
                  rawPrice: rawPrice,
                  scalingApplied: adjustedPrice !== rawPrice
              };

          } catch (error) {
              console.log(`⚠️ Error getting price for pool ${poolAddress}: ${error.message}`);
              return null;
          }
      }

    calculatePoolOpportunity(jupiterPrice, poolData, poolPrice) {
        if (!poolPrice) return null;

        const jupiterRate = jupiterPrice.hositcoInSOL;
        const poolRate = poolPrice.hositcoInSOL;

        const priceDiff = poolRate - jupiterRate;
        const priceDiffPercent = (priceDiff / jupiterRate) * 100;

        // Determine if this would be a buy or sell opportunity
        const wouldBeBuy = priceDiffPercent < 0; // Pool cheaper than Jupiter
        const wouldBeSell = priceDiffPercent > 0; // Pool more expensive than Jupiter

        // Calculate dynamic profit threshold based on trade type
        const buyThreshold = this.calculateDynamicProfitThreshold(true);  // Dynamic for BUY
        const sellThreshold = this.calculateDynamicProfitThreshold(false); // Base for SELL

        // Required profit = pool fee + appropriate threshold
        const requiredProfitBuy = poolData.baseFeePercent + buyThreshold;
        const requiredProfitSell = poolData.baseFeePercent + sellThreshold;

        const absPriceDiff = Math.abs(priceDiffPercent);

        // Check viability based on trade type
        const shouldBuy = wouldBeBuy && absPriceDiff >= requiredProfitBuy;
        const shouldSell = wouldBeSell && absPriceDiff >= requiredProfitSell;

        const isViable = shouldBuy || shouldSell;

        // In sell-only mode, filter out buy opportunities
        const isViableForCurrentMode = this.sellOnlyMode ?
            (isViable && shouldSell) :
            isViable;

        // Calculate profit potential using the appropriate threshold
        const relevantThreshold = wouldBeBuy ? buyThreshold : sellThreshold;
        const relevantRequiredProfit = wouldBeBuy ? requiredProfitBuy : requiredProfitSell;

        return {
            poolAddress: poolData.address,
            poolName: poolData.name,
            binStep: poolData.bin_step,
            liquiditySOL: poolData.liquiditySOL,
            baseFee: poolData.baseFeePercent,
            maxFee: poolData.maxFeePercent,

            // Thresholds
            buyThreshold: buyThreshold,
            sellThreshold: sellThreshold,
            requiredProfit: relevantRequiredProfit,
            usedThreshold: relevantThreshold,

            jupiterPrice: jupiterRate,
            poolPrice: poolRate,
            priceDiff: priceDiff,
            priceDiffPercent: priceDiffPercent,

            isViable: isViableForCurrentMode,
            shouldBuyOnPool: shouldBuy && !this.sellOnlyMode, // Disable buy in sell-only mode
            shouldSellOnPool: shouldSell,

            profitPotential: absPriceDiff - poolData.baseFeePercent,
            rank: isViableForCurrentMode ? absPriceDiff - relevantRequiredProfit : 0,

            // Additional flags for logging
            wouldBeBuyOpportunity: shouldBuy,
            wouldBeSellOpportunity: shouldSell,
            filteredByBalance: this.sellOnlyMode && shouldBuy
        };
    }

    async scanAllPools(jupiterPrice) {
        console.log(`\n🔍 Scanning ${this.poolCache.length} pools for arbitrage opportunities...`);
        console.log(`📈 Jupiter Price: ${jupiterPrice.hositcoInSOL.toFixed(12)} SOL/TOKEN`);

        // Show current profit thresholds
        const buyThreshold = this.calculateDynamicProfitThreshold(true);
        const sellThreshold = this.calculateDynamicProfitThreshold(false);
        console.log(`🎯 Current Profit Thresholds: BUY ${buyThreshold.toFixed(1)}% | SELL ${sellThreshold.toFixed(1)}%`);
        console.log(`📊 Net BUY trades: ${this.stats.netBuyTrades} (BUY: ${this.stats.buyTrades}, SELL: ${this.stats.sellTrades})`);

        if (this.sellOnlyMode) {
            console.log(`🔒 SELL-ONLY MODE: Only scanning for sell opportunities (SOL balance: ${this.currentSOLBalance.toFixed(6)})`);
        }

        const opportunities = [];
        let scannedCount = 0;
        let filteredByBalanceCount = 0;

        for (const pool of this.poolCache) {
            try {
                console.log(`📊 Getting pool info for: ${pool.address}`);

                const poolPrice = await this.getPoolPrice(pool.address);

                if (poolPrice) {
                    const opportunity = this.calculatePoolOpportunity(jupiterPrice, pool, poolPrice);

                    // Display price with diff percentage for every pool
                    const diffPercent = opportunity.priceDiffPercent;
                    const diffColor = diffPercent > 0 ? '📈' : '📉';
                    const diffSign = diffPercent > 0 ? '+' : '';

                    console.log(`✅ Pool price: ${poolPrice.hositcoInSOL.toFixed(12)} SOL/TOKEN ${diffColor} ${diffSign}${diffPercent.toFixed(4)}%`);
                    console.log(`   Bin step: ${pool.bin_step}, Liquidity: ${pool.liquiditySOL.toFixed(2)} SOL, Fee: ${pool.baseFeePercent}%`);

                    if (opportunity.filteredByBalance) {
                        console.log(`🔒 Buy opportunity filtered due to low SOL balance (${this.currentSOLBalance.toFixed(6)} < ${this.config.minSOLBalance})`);
                        filteredByBalanceCount++;
                    }

                    if (opportunity) {
                        opportunities.push(opportunity);
                        scannedCount++;

                        if (opportunity.isViable) {
                            console.log(`🎯 *** ARBITRAGE OPPORTUNITY ***`);
                            console.log(`   Trade type: ${opportunity.shouldBuyOnPool ? 'BUY' : 'SELL'}`);
                            console.log(`   Threshold used: ${opportunity.usedThreshold.toFixed(1)}% (BUY: ${opportunity.buyThreshold.toFixed(1)}%, SELL: ${opportunity.sellThreshold.toFixed(1)}%)`);
                            console.log(`   Required profit: ${opportunity.requiredProfit.toFixed(2)}%`);
                            console.log(`   Actual diff: ${Math.abs(opportunity.priceDiffPercent).toFixed(4)}%`);
                            console.log(`   Net profit potential: ${opportunity.profitPotential.toFixed(4)}%`);
                        }
                    }
                } else {
                    console.log(`❌ Failed to get price for pool`);
                }

                // Rate limiting: Wait 2 seconds between each pool query to avoid 429 errors
                console.log(`⏱️ Waiting 2 seconds before next pool...`);
                await new Promise(resolve => setTimeout(resolve, 2000));

            } catch (error) {
                console.log(`⚠️ Error scanning pool ${pool.address}: ${error.message}`);

                // If we hit a rate limit, wait longer
                if (error.message.includes('429') || error.message.includes('Too Many Requests')) {
                    console.log(`🛑 Rate limited! Waiting 10 seconds...`);
                    await new Promise(resolve => setTimeout(resolve, 10000));
                } else {
                    // Still wait a bit for other errors
                    await new Promise(resolve => setTimeout(resolve, 1000));
                }
            }
        }

        this.stats.poolsScanned = scannedCount;

        // Sort opportunities by profit potential (highest first)
        const viableOpportunities = opportunities
            .filter(op => op.isViable)
            .sort((a, b) => b.rank - a.rank);

        console.log(`\n📊 Scan complete: ${scannedCount} pools scanned, ${viableOpportunities.length} viable opportunities found`);

        if (filteredByBalanceCount > 0) {
            console.log(`🔒 ${filteredByBalanceCount} buy opportunities filtered due to low SOL balance`);
        }

        return viableOpportunities;
    }

    async executeArbitrageTrade(opportunity) {
        try {
            const now = Date.now();

            // Rate limiting checks
            if (now - this.lastTradeTime < this.config.minCooldownMs) {
                console.log('⏱️ Cooldown period active, skipping trade');
                return false;
            }

            if (this.stats.totalTrades >= this.config.maxTradesPerHour) {
                console.log('🛑 Max trades per hour reached, stopping');
                return false;
            }

            // Double-check SOL balance before executing any trade
            await this.checkSOLBalance();

            // Additional safety check for buy trades
            if (opportunity.shouldBuyOnPool && this.sellOnlyMode) {
                console.log('🔒 Skipping buy trade due to low SOL balance (sell-only mode active)');
                return false;
            }

            console.log(`\n🔄 Executing arbitrage trade #${this.stats.totalTrades + 1}`);
            console.log(`  Pool: ${opportunity.poolName} (${opportunity.poolAddress})`);
            console.log(`  Direction: ${opportunity.shouldBuyOnPool ? 'BUY' : 'SELL'}`);
            console.log(`  Price difference: ${opportunity.priceDiffPercent.toFixed(4)}%`);
            console.log(`  Expected profit: ${opportunity.profitPotential.toFixed(4)}%`);
            console.log(`  SOL Balance: ${this.currentSOLBalance.toFixed(6)} SOL (${this.sellOnlyMode ? 'SELL-ONLY' : 'NORMAL'} mode)`);

            if (opportunity.shouldBuyOnPool) {
                // Buy TOKEN on this pool (SOL -> TOKEN)
                const tradeAmountLamports = Math.floor(this.config.tradeAmountSOL * 1e9);
                const minAmountOut = 1;

                console.log(`💰 Buying TOKEN on ${opportunity.poolName}`);
                console.log(`  Trade amount: ${this.config.tradeAmountSOL} SOL`);

                const result = await this.swapClient.executeSwap(
                    opportunity.poolAddress,
                    tradeAmountLamports,
                    minAmountOut,
                    true // SOL to TOKEN
                );

                if (result.success) {
                    console.log('✅ BUY Trade successful!');
                    console.log(`   TX: ${result.signature}`);
                    console.log(`   Pool: ${opportunity.poolName}`);
                    console.log(`   Spent: ${result.consumedInAmount} lamports SOL`);
                    console.log(`   Got: ${result.outAmount} TOKEN tokens`);

                    this.stats.successfulTrades++;
                    this.stats.buyTrades++;
                    this.stats.netBuyTrades++; // Increment net BUY count
                    this.stats.totalProfit += parseFloat(result.outAmount) * opportunity.priceDiff;

                    console.log(`📈 Updated thresholds: Net BUY trades now ${this.stats.netBuyTrades}`);
                    console.log(`   Next BUY threshold: ${this.calculateDynamicProfitThreshold(true).toFixed(1)}%`);
                    console.log(`   SELL threshold (unchanged): ${this.calculateDynamicProfitThreshold(false).toFixed(1)}%`);

                    this.stats.totalTrades++;
                    this.lastTradeTime = now;
                    return true;
                }

            } else if (opportunity.shouldSellOnPool) {// Sell TOKEN on this pool (TOKEN -> SOL)

                // Calculate the amount of tokens to sell based on trade amount in SOL
                // First get the current pool price to estimate token amount needed
                const poolPriceSOLPerToken = opportunity.poolPrice; // This is already in SOL per TOKEN

                // Calculate tokens needed to get approximately tradeAmountSOL worth of SOL
                const estimatedTokenAmount = Math.floor((this.config.tradeAmountSOL / poolPriceSOLPerToken) * 1e8); // SPX has 8 decimals

                console.log(`📈 Selling TOKEN on ${opportunity.poolName}`);
                console.log(`  Pool price: ${poolPriceSOLPerToken.toFixed(12)} SOL per TOKEN`);
                console.log(`  Target SOL value: ${this.config.tradeAmountSOL} SOL`);
                console.log(`  Estimated TOKEN to sell: ${estimatedTokenAmount / 1e8} TOKEN`);

                try {
                    const quote = await this.swapClient.getSwapQuote(
                        opportunity.poolAddress,
                        estimatedTokenAmount,
                        false // TOKEN to SOL
                    );

                    if (quote && quote.outAmount) {
                        const expectedSOL = parseFloat(quote.outAmount) / 1e9;

                        // Calculate minimum amount out with 2% slippage
                        const slippagePercent = 2; // 2% slippage
                        const minAmountOutLamports = Math.floor(parseFloat(quote.outAmount) * (100 - slippagePercent) / 100);

                        console.log(`  Expected SOL output: ${expectedSOL.toFixed(6)} SOL`);
                        console.log(`  Min SOL output (${slippagePercent}% slippage): ${minAmountOutLamports / 1e9} SOL`);

                        const result = await this.swapClient.executeSwap(
                            opportunity.poolAddress,
                            estimatedTokenAmount,
                            minAmountOutLamports, // Use calculated minimum amount out in lamports
                            false // TOKEN to SOL
                        );

                        if (result.success) {
                            console.log('✅ SELL Trade successful!');
                            console.log(`   TX: ${result.signature}`);
                            console.log(`   Pool: ${opportunity.poolName}`);
                            console.log(`   Spent: ${result.consumedInAmount} TOKEN tokens`);
                            console.log(`   Got: ${result.outAmount} lamports SOL (${parseFloat(result.outAmount) / 1e9} SOL)`);

                            this.stats.successfulTrades++;
                            this.stats.sellTrades++;
                            this.stats.netBuyTrades = Math.max(0, this.stats.netBuyTrades - 1); // Decrement net BUY count, never below 0
                            this.stats.totalProfit += (parseFloat(result.outAmount) / 1e9) * opportunity.priceDiff;

                            console.log(`📉 Updated thresholds: Net BUY trades now ${this.stats.netBuyTrades}`);
                            console.log(`   Next BUY threshold: ${this.calculateDynamicProfitThreshold(true).toFixed(1)}%`);
                            console.log(`   SELL threshold (unchanged): ${this.calculateDynamicProfitThreshold(false).toFixed(1)}%`);

                            this.stats.totalTrades++;
                            this.lastTradeTime = now;
                            return true;
                        }
                    } else {
                        console.log('❌ No valid quote received for sell trade');
                        return false;
                    }

                } catch (sellError) {
                    console.log(`❌ SELL trade failed: ${sellError.message}`);
                    if (sellError.message.includes('insufficient') || sellError.message.includes('balance')) {
                        console.log('💡 Insufficient TOKEN balance for sell trade');
                    }
                    return false;
                }
            }

    async monitorPools() {
        console.log('\n📊 Starting pool monitoring cycle...');

        // Check SOL balance first
        await this.checkSOLBalance();

        // Update pool cache if needed
        if (Date.now() - this.lastPoolUpdate > this.config.poolCacheMs || this.poolCache.length === 0) {
            await this.fetchMeteoraPoolData();
        }

        // Load Jupiter prices
        const jupiterPrice = await this.loadJupiterPrices();
        if (!jupiterPrice) {
            console.log('❌ Failed to load Jupiter prices, retrying...');
            return;
        }

        console.log(`📈 Jupiter Price: ${jupiterPrice.hositcoInSOL.toFixed(12)} SOL/TOKEN`);
        console.log(`⚡ Jupiter data age: ${jupiterPrice.ageMs}ms`);

        // Scan all pools for opportunities
        const opportunities = await this.scanAllPools(jupiterPrice);

        if (opportunities.length > 0) {
            console.log(`\n🎯 ${opportunities.length} ARBITRAGE OPPORTUNITIES FOUND!`);

            if (this.sellOnlyMode) {
                console.log(`🔒 Operating in SELL-ONLY mode due to low SOL balance`);
            }

            // Show top 3 opportunities
            const topOpportunities = opportunities.slice(0, 3);
            topOpportunities.forEach((op, index) => {
                console.log(`\n${index + 1}. ${op.poolName}:`);
                console.log(`   Trade type: ${op.shouldBuyOnPool ? 'BUY' : 'SELL'}`);
                console.log(`   Threshold used: ${op.usedThreshold.toFixed(1)}% (BUY: ${op.buyThreshold.toFixed(1)}%, SELL: ${op.sellThreshold.toFixed(1)}%)`);
                console.log(`   Price diff: ${op.priceDiffPercent.toFixed(4)}% (required: ${op.requiredProfit.toFixed(2)}%)`);
                console.log(`   Profit potential: ${op.profitPotential.toFixed(4)}%`);
                console.log(`   Liquidity: ${op.liquiditySOL.toFixed(2)} SOL`);
                console.log(`   Bin step: ${op.binStep}`);
            });

            // Execute the best opportunity
            const bestOpportunity = opportunities[0];
            console.log(`\n🚀 Executing best opportunity: ${bestOpportunity.poolName}`);
            await this.executeArbitrageTrade(bestOpportunity);

        } else {
            console.log(`💤 No arbitrage opportunities found across ${this.poolCache.length} pools`);
            if (this.sellOnlyMode) {
                console.log(`🔒 Note: Currently in SELL-ONLY mode due to low SOL balance (${this.currentSOLBalance.toFixed(6)} < ${this.config.minSOLBalance})`);
            }
        }

        // Show session stats
        console.log(`\n📊 Session Stats:`);
        console.log(`   Cycles: ${this.tradeCount}`);
        console.log(`   Pools monitored: ${this.poolCache.length}`);
        console.log(`   Last scan: ${this.stats.poolsScanned} pools`);
        console.log(`   SOL Balance: ${this.currentSOLBalance.toFixed(6)} SOL (${this.sellOnlyMode ? 'SELL-ONLY' : 'NORMAL'} mode)`);
        console.log(`   Net BUY trades: ${this.stats.netBuyTrades} (affects BUY threshold)`);
        console.log(`   Current thresholds: BUY ${this.calculateDynamicProfitThreshold(true).toFixed(1)}% | SELL ${this.calculateDynamicProfitThreshold(false).toFixed(1)}%`);
        console.log(`   Sell-only periods: ${this.stats.sellOnlyPeriods}`);
        console.log(`   Trades: ${this.stats.totalTrades} (${this.stats.successfulTrades} successful)`);
        console.log(`   Buy trades: ${this.stats.buyTrades} | Sell trades: ${this.stats.sellTrades}`);
        console.log(`   Runtime: ${Math.floor((Date.now() - this.stats.startTime) / 1000)}s`);
        console.log(`   Last trade: ${this.lastTradeTime ? Math.floor((Date.now() - this.lastTradeTime) / 1000) + 's ago' : 'Never'}`);

        this.tradeCount++;
    }

    async start() {
        if (this.isRunning) {
            console.log('⚠️ Enhanced arbitrage bot is already running');
            return;
        }

        this.isRunning = true;
        console.log('🚀 Starting Enhanced Meteora DLMM Arbitrage Bot...');
        console.log(`🎯 Target token: TOKEN (${this.config.tokenMintX})`);
        console.log(`💰 Trade size: ${this.config.tradeAmountSOL} SOL`);
        console.log(`📊 Min liquidity: ${this.config.minLiquiditySOL} SOL`);
        console.log(`💸 Max pool fee: ${this.config.maxPoolFee}%`);
        console.log(`📈 Base profit threshold: ${this.config.baseProfitThreshold}%`);
        console.log(`📊 Dynamic BUY threshold: ${this.calculateDynamicProfitThreshold(true).toFixed(1)}% (base + ${this.stats.netBuyTrades} net trades × 0.1%)`);
        console.log(`📊 SELL threshold: ${this.calculateDynamicProfitThreshold(false).toFixed(1)}% (always base threshold)`);
        console.log(`🔒 SOL balance threshold: ${this.config.minSOLBalance} SOL (sell-only below this)`);
        console.log(`⏱️ Check interval: ${this.config.checkIntervalMs}ms`);
        console.log(`🔄 Cooldown: ${this.config.minCooldownMs}ms`);
        console.log(`🛑 Max trades/hour: ${this.config.maxTradesPerHour}`);

        // Initial balance and pool data fetch
        await this.checkSOLBalance();
        await this.fetchMeteoraPoolData();

        // Main monitoring loop
        while (this.isRunning) {
            try {
                await this.monitorPools();

                // Wait before next check
                await new Promise(resolve => setTimeout(resolve, this.config.checkIntervalMs));

            } catch (error) {
                console.error('💥 Error in monitoring loop:', error.message);
                console.log('⏸️ Waiting 30 seconds before retry...');
                await new Promise(resolve => setTimeout(resolve, 30000));
            }
        }
    }

    stop() {
        console.log('\n🛑 Stopping enhanced arbitrage bot...');
        this.isRunning = false;

        // Final stats
        console.log(`\n📊 Final Session Stats:`);
        console.log(`   Total cycles: ${this.tradeCount}`);
        console.log(`   Pools monitored: ${this.poolCache.length}`);
        console.log(`   SOL Balance: ${this.currentSOLBalance.toFixed(6)} SOL`);
        console.log(`   Net BUY trades: ${this.stats.netBuyTrades}`);
        console.log(`   Final BUY threshold: ${this.calculateDynamicProfitThreshold(true).toFixed(1)}%`);
        console.log(`   Final SELL threshold: ${this.calculateDynamicProfitThreshold(false).toFixed(1)}%`);
        console.log(`   Sell-only periods: ${this.stats.sellOnlyPeriods}`);
        console.log(`   Total trades: ${this.stats.totalTrades}`);
        console.log(`   Successful trades: ${this.stats.successfulTrades}`);
        console.log(`   Buy trades: ${this.stats.buyTrades} | Sell trades: ${this.stats.sellTrades}`);
        console.log(`   Success rate: ${this.stats.totalTrades ? (this.stats.successfulTrades / this.stats.totalTrades * 100).toFixed(1) : 0}%`);
        console.log(`   Total runtime: ${Math.floor((Date.now() - this.stats.startTime) / 1000)}s`);
    }
}

// Main execution
async function main() {
    const rpc_urlx = "https://floral-green-season.solana-mainnet.quiknode.pro/4ae0bc7877cffb071f3a9e54d32ce2b0da4db11b/";
    const RPC_URL = process.env.RPC_URL || rpc_urlx;
    const PRIVATE_KEY = process.env.PRIVATE_KEY;

    if (!PRIVATE_KEY) {
        throw new Error("PRIVATE_KEY environment variable is required");
    }

    const arbitrageBot = new EnhancedMeteoraDLMMArbitrage(RPC_URL, PRIVATE_KEY);

    // Graceful shutdown
    process.on('SIGINT', () => {
        console.log('\n🔴 Received SIGINT, shutting down gracefully...');
        arbitrageBot.stop();
        process.exit(0);
    });

    process.on('SIGTERM', () => {
        console.log('\n🔴 Received SIGTERM, shutting down gracefully...');
        arbitrageBot.stop();
        process.exit(0);
    });

    // Start the enhanced bot
    await arbitrageBot.start();
}

// Run if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
    main().catch(error => {
        console.error('💥 Fatal error:', error.message);
        process.exit(1);
    });
}

export { EnhancedMeteoraDLMMArbitrage };
