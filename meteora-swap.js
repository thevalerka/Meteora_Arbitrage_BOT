// meteora-swap.js
// Fixed Direct Node.js implementation using Meteora DLMM SDK

import dlmmPkg from '@meteora-ag/dlmm';
import { Connection, Keypair, PublicKey, sendAndConfirmTransaction, Transaction } from '@solana/web3.js';
import { getAssociatedTokenAddress, createAssociatedTokenAccountInstruction } from '@solana/spl-token';
import anchor from '@coral-xyz/anchor';
import bs58 from 'bs58';
import dotenv from 'dotenv';

// Use default export as DLMM (this is the working method)
const DLMM = dlmmPkg.default;
const { BN } = anchor;

// Load environment variables
dotenv.config();

class MeteoraDLMMSwap {
    constructor(rpcUrl, privateKeyBase58) {
        this.connection = new Connection(rpcUrl, 'confirmed');
        this.wallet = Keypair.fromSecretKey(bs58.decode(privateKeyBase58));

        console.log(`🔑 Wallet: ${this.wallet.publicKey.toString()}`);
    }

    async getPoolInfo(poolAddress) {
        try {
            console.log(`📊 Getting pool info for: ${poolAddress}`);

            const dlmmPool = await DLMM.create(this.connection, new PublicKey(poolAddress));
            await dlmmPool.refetchStates();

            const activeBin = await dlmmPool.getActiveBin();

            // Get token decimals properly
            let tokenXDecimals, tokenYDecimals;
            try {
                tokenXDecimals = dlmmPool.tokenX.decimals || dlmmPool.tokenX.decimal || 6; // Default to 6 for SPX
                tokenYDecimals = dlmmPool.tokenY.decimals || dlmmPool.tokenY.decimal || 9; // Default to 9 for SOL
            } catch (decimalError) {
                console.warn('⚠️ Error getting token decimals, using defaults');
                tokenXDecimals = 6; // SPX has 6 decimals
                tokenYDecimals = 9; // SOL has 9 decimals
            }

            const poolInfo = {
                poolAddress: dlmmPool.pubkey.toString(),
                tokenX: {
                    mint: dlmmPool.tokenX.publicKey.toString(),
                    decimals: tokenXDecimals
                },
                tokenY: {
                    mint: dlmmPool.tokenY.publicKey.toString(),
                    decimals: tokenYDecimals
                },
                activeBin: {
                    binId: activeBin.binId,
                    price: activeBin.price
                },
                binStep: dlmmPool.lbPair.binStep
            };

            console.log('✅ Pool info retrieved:');
            console.log(`  Token X: ${poolInfo.tokenX.mint} (decimals: ${poolInfo.tokenX.decimals})`);
            console.log(`  Token Y: ${poolInfo.tokenY.mint} (decimals: ${poolInfo.tokenY.decimals})`);
            console.log(`  Active bin: ${poolInfo.activeBin.binId} (price: ${poolInfo.activeBin.price})`);
            console.log(`  Bin step: ${poolInfo.binStep}`);

            return poolInfo;

        } catch (error) {
            console.error('❌ Error getting pool info:', error.message);
            throw error;
        }
    }

    async getSwapQuote(poolAddress, amountIn, swapYtoX = false) {
        try {
            console.log(`💰 Getting swap quote...`);
            console.log(`  Amount in: ${amountIn}`);
            console.log(`  Swap Y to X: ${swapYtoX}`);

            const dlmmPool = await DLMM.create(this.connection, new PublicKey(poolAddress));
            await dlmmPool.refetchStates();

            const binArrays = await dlmmPool.getBinArrayForSwap(swapYtoX);
            console.log(`  Bin arrays found: ${binArrays.length}`);

            const swapQuote = await dlmmPool.swapQuote(
                new BN(amountIn),
                swapYtoX,
                new BN(10), // 10 basis points slippage (1%)
                binArrays
            );

            console.log('📈 Quote received:');
            console.log(`  Consumed in amount: ${swapQuote.consumedInAmount.toString()}`);
            console.log(`  Out amount: ${swapQuote.outAmount.toString()}`);
            console.log(`  Min amount out: ${swapQuote.minOutAmount.toString()}`);
            console.log(`  Fee: ${swapQuote.fee.toString()}`);
            console.log(`  Protocol fee: ${swapQuote.protocolFee.toString()}`);
            console.log(`  Price impact: ${swapQuote.priceImpact}%`);
            console.log(`  End price: ${swapQuote.endPrice}`);

            return {
                consumedInAmount: swapQuote.consumedInAmount.toString(),
                outAmount: swapQuote.outAmount.toString(),
                minOutAmount: swapQuote.minOutAmount.toString(),
                fee: swapQuote.fee.toString(),
                protocolFee: swapQuote.protocolFee.toString(),
                priceImpact: swapQuote.priceImpact,
                endPrice: swapQuote.endPrice,
                binArraysPubkey: swapQuote.binArraysPubkey
            };

        } catch (error) {
            console.error('❌ Error getting quote:', error.message);
            throw error;
        }
    }

    async executeSwap(poolAddress, amountIn, minAmountOut, swapYtoX = false) {
        try {
            console.log(`🔄 Executing swap...`);
            console.log(`  Pool: ${poolAddress}`);
            console.log(`  Amount in: ${amountIn}`);
            console.log(`  Min amount out: ${minAmountOut}`);
            console.log(`  Swap Y to X: ${swapYtoX}`);

            // Validate inputs
            if (!amountIn || amountIn <= 0) {
                throw new Error('Invalid amountIn');
            }
            if (isNaN(minAmountOut) || minAmountOut < 0) {
                console.warn('⚠️ Invalid minAmountOut, setting to 1');
                minAmountOut = 1;
            }

            const dlmmPool = await DLMM.create(this.connection, new PublicKey(poolAddress));
            await dlmmPool.refetchStates();

            // Get bin arrays for swap - CRITICAL: Use fresh bin arrays
            const binArrays = await dlmmPool.getBinArrayForSwap(swapYtoX);
            console.log(`📊 Found ${binArrays.length} bin arrays for swap`);

            if (binArrays.length === 0) {
                throw new Error('No bin arrays found for swap - insufficient liquidity');
            }

            // The bin arrays from Meteora SDK are complete objects with account and publicKey properties
            // We should NOT extract just the PublicKey - the SDK needs the full objects
            console.log(`📊 Found ${binArrays.length} bin arrays for swap`);
            console.log(`📊 First bin array structure:`, {
                hasAccount: !!binArrays[0]?.account,
                hasPublicKey: !!binArrays[0]?.publicKey,
                accountIndex: binArrays[0]?.account?.index?.toString(),
            });

            if (binArrays.length === 0) {
                throw new Error('No bin arrays found for swap - insufficient liquidity');
            }

            // Validate that bin arrays have the expected structure but don't modify them
            const validatedBinArrays = binArrays.map((binArray, index) => {
                if (!binArray || typeof binArray !== 'object') {
                    throw new Error(`Bin array ${index} is not an object`);
                }
                
                if (!binArray.account || !binArray.publicKey) {
                    throw new Error(`Bin array ${index} missing required account or publicKey properties`);
                }
                
                if (!binArray.account.index) {
                    throw new Error(`Bin array ${index} missing account.index property`);
                }
                
                return binArray; // Return the original object unchanged
            });

            console.log(`✅ Validated ${validatedBinArrays.length} bin arrays`);

            // Get swap quote with proper slippage
            const swapQuote = await dlmmPool.swapQuote(
                new BN(amountIn),
                swapYtoX,
                new BN(100), // 100 basis points (1%) slippage tolerance - increased for stability
                validatedBinArrays // Pass the full bin array objects
            );

            console.log(`💱 Quote details:`);
            console.log(`  Consumed: ${swapQuote.consumedInAmount.toString()}`);
            console.log(`  Out amount: ${swapQuote.outAmount.toString()}`);
            console.log(`  Min out: ${swapQuote.minOutAmount.toString()}`);
            console.log(`  Price impact: ${swapQuote.priceImpact}%`);

            // Use the larger of provided minAmountOut or quote's minOutAmount
            const quotedMinOut = parseInt(swapQuote.minOutAmount.toString());
            const finalMinOut = Math.max(minAmountOut || 1, quotedMinOut);

            console.log(`🎯 Using min amount out: ${finalMinOut}`);

            // Ensure all PublicKey objects are valid
            const userPubkey = new PublicKey(this.wallet.publicKey.toString());
            const inTokenPubkey = new PublicKey((swapYtoX ? dlmmPool.tokenY.publicKey : dlmmPool.tokenX.publicKey).toString());
            const outTokenPubkey = new PublicKey((swapYtoX ? dlmmPool.tokenX.publicKey : dlmmPool.tokenY.publicKey).toString());
            const lbPairPubkey = new PublicKey(dlmmPool.pubkey.toString());

            // Create swap transaction using the SDK method with validated inputs
            let swapTx;
            try {
                // For the swap transaction, we need to pass just the PublicKey objects for binArraysPubkey
                // but keep the full objects for the quote operation
                const binArrayPublicKeys = validatedBinArrays.map(binArray => binArray.publicKey);
                
                console.log(`📊 Creating swap transaction with ${binArrayPublicKeys.length} bin array public keys`);
                
                swapTx = await dlmmPool.swap({
                    user: userPubkey,
                    inToken: inTokenPubkey,
                    outToken: outTokenPubkey,
                    inAmount: new BN(amountIn),
                    minOutAmount: new BN(finalMinOut),
                    lbPair: lbPairPubkey,
                    binArraysPubkey: binArrayPublicKeys // Use only PublicKey objects for transaction
                });
            } catch (swapCreateError) {
                console.error('❌ Error creating swap transaction:', swapCreateError.message);
                
                // Try alternative approach - use swapQuote for a more conservative swap
                console.log('🔄 Trying fallback with higher slippage...');
                
                // Get a new quote with higher slippage tolerance
                const fallbackQuote = await dlmmPool.swapQuote(
                    new BN(amountIn),
                    swapYtoX,
                    new BN(500), // 500 basis points (5%) slippage tolerance
                    validatedBinArrays // Use the same validated bin arrays for quote
                );
                
                const fallbackMinOut = Math.floor(parseInt(fallbackQuote.minOutAmount.toString()) * 0.95); // 5% additional buffer
                const binArrayPublicKeys = validatedBinArrays.map(binArray => binArray.publicKey);
                
                swapTx = await dlmmPool.swap({
                    user: userPubkey,
                    inToken: inTokenPubkey,
                    outToken: outTokenPubkey,
                    inAmount: new BN(amountIn),
                    minOutAmount: new BN(fallbackMinOut),
                    lbPair: lbPairPubkey,
                    binArraysPubkey: binArrayPublicKeys // Use only PublicKey objects for transaction
                });
                
                if (!swapTx) {
                    throw new Error('Failed to create swap transaction with fallback method');
                }
            }

            console.log('📝 Transaction created, sending...');

            // Send and confirm transaction
            let txSignature;
            try {
                txSignature = await sendAndConfirmTransaction(
                    this.connection,
                    swapTx,
                    [this.wallet],
                    {
                        skipPreflight: false,
                        commitment: 'confirmed',
                        maxRetries: 2,
                        preflightCommitment: 'confirmed'
                    }
                );
            } catch (sendError) {
                console.warn(`⚠️ Transaction failed: ${sendError.message}`);
                throw sendError;
            }

            console.log('🎉 Swap completed successfully!');
            console.log(`📋 Transaction: ${txSignature}`);
            console.log(`🔗 View on Solscan: https://solscan.io/tx/${txSignature}`);

            return {
                success: true,
                signature: txSignature,
                consumedInAmount: swapQuote.consumedInAmount.toString(),
                outAmount: swapQuote.outAmount.toString(),
                minAmountOut: finalMinOut.toString(),
                fee: swapQuote.fee.toString(),
                priceImpact: swapQuote.priceImpact,
                binArraysUsed: validatedBinArrays.length
            };

        } catch (error) {
            console.error('❌ Swap failed:', error.message);
            console.error('Error details:', error);
            
            // Log additional details for debugging
            if (error.logs) {
                console.error('Transaction logs:', error.logs);
            }
            
            return {
                success: false,
                error: error.message,
                logs: error.logs
            };
        }
    }

    // Helper method to check token account existence
    async ensureTokenAccount(tokenMint) {
        try {
            const associatedTokenAccount = await getAssociatedTokenAddress(
                new PublicKey(tokenMint),
                this.wallet.publicKey
            );

            const accountInfo = await this.connection.getAccountInfo(associatedTokenAccount);
            
            if (!accountInfo) {
                console.log(`📝 Creating token account for ${tokenMint}`);
                
                const createATAInstruction = createAssociatedTokenAccountInstruction(
                    this.wallet.publicKey,
                    associatedTokenAccount,
                    this.wallet.publicKey,
                    new PublicKey(tokenMint)
                );

                const transaction = new Transaction().add(createATAInstruction);
                
                const signature = await sendAndConfirmTransaction(
                    this.connection,
                    transaction,
                    [this.wallet]
                );
                
                console.log(`✅ Token account created: ${signature}`);
                return associatedTokenAccount;
            }

            console.log(`✅ Token account exists: ${associatedTokenAccount.toString()}`);
            return associatedTokenAccount;

        } catch (error) {
            console.error('❌ Error ensuring token account:', error.message);
            throw error;
        }
    }
}

// Main execution
async function main() {
    try {
        // Configuration
        const RPC_URL = process.env.RPC_URL || "https://api.mainnet-beta.solana.com";
        const PRIVATE_KEY = process.env.PRIVATE_KEY;

        if (!PRIVATE_KEY) {
            throw new Error("PRIVATE_KEY environment variable is required");
        }

        // SPX-SOL pool details (your target token)
        const POOL_ADDRESS = "9z19o7kZW98DLPE52sSrVX9Un5ywtbx5q7WeQTvcfwF8"; // Your actual pool
        const TOKEN_MINT_X = "71Jvq4Epe2FCJ7JFSF7jLXdNk1Wy4Bhqd9iL6bEFELvg"; // SPX (6 decimals)
        const TOKEN_MINT_Y = "So11111111111111111111111111111111111111112";  // SOL (9 decimals)

        // Swap parameters
        const AMOUNT_IN = 10000000;  // 0.01 SOL (SOL has 9 decimals)
        const MIN_AMOUNT_OUT = 100;  // Minimum SPX tokens out (SPX has 6 decimals)
        const SWAP_Y_TO_X = true;    // SOL to SPX

        console.log('🚀 Starting Meteora DLMM Swap...');
        console.log(`Pool: ${POOL_ADDRESS}`);
        console.log(`Swapping: ${SWAP_Y_TO_X ? 'SOL → SPX' : 'SPX → SOL'}`);
        console.log(`Amount: ${AMOUNT_IN} (${AMOUNT_IN / 1e9} SOL)`);

        // Initialize swap client
        const swapClient = new MeteoraDLMMSwap(RPC_URL, PRIVATE_KEY);

        // Ensure token accounts exist
        await swapClient.ensureTokenAccount(TOKEN_MINT_X);
        await swapClient.ensureTokenAccount(TOKEN_MINT_Y);

        // Get pool information
        const poolInfo = await swapClient.getPoolInfo(POOL_ADDRESS);

        // Get swap quote
        const quote = await swapClient.getSwapQuote(POOL_ADDRESS, AMOUNT_IN, SWAP_Y_TO_X);

        // Ask for confirmation (comment out for auto-execution)
        console.log('\n⚠️  Review the quote above. Press Ctrl+C to cancel or wait 5 seconds to continue...');
        await new Promise(resolve => setTimeout(resolve, 5000));

        // Execute swap
        const result = await swapClient.executeSwap(
            POOL_ADDRESS,
            AMOUNT_IN,
            MIN_AMOUNT_OUT,
            SWAP_Y_TO_X
        );

        console.log('\n🎯 Swap Summary:');
        console.log(`✅ Success: ${result.success}`);
        if (result.success) {
            console.log(`📋 Transaction: ${result.signature}`);
            console.log(`💰 Consumed In: ${result.consumedInAmount}`);
            console.log(`💸 Out Amount: ${result.outAmount}`);
            console.log(`🎯 Min Amount Out: ${result.minAmountOut}`);
            console.log(`💳 Fee: ${result.fee}`);
            console.log(`📊 Price Impact: ${result.priceImpact}%`);
            console.log(`🗂️ Bin Arrays Used: ${result.binArraysUsed}`);
        } else {
            console.log(`❌ Error: ${result.error}`);
        }

    } catch (error) {
        console.error('💥 Error in main:', error.message);
        console.error('Stack:', error.stack);
        process.exit(1);
    }
}

// Run if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
    main();
}

export { MeteoraDLMMSwap };