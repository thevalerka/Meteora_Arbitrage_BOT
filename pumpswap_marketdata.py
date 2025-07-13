import asyncio
import websockets
import json
import os
import time
from datetime import datetime


wallet_public = ""
wallet_private = ""
api_key = ""


def extract_trade_data(message_data):
    """
    Extract mint and calculate price metrics from trade data
    """
    try:
        # Extract mint
        mint = message_data.get('mint', 'N/A')

        # Extract required values for price calculations
        sol_in_pool = message_data.get('solInPool', 0)
        tokens_in_pool = message_data.get('tokensInPool', 0)
        market_cap_sol = message_data.get('marketCapSol', 0)
        sol_amount = message_data.get('solAmount', 0)
        token_amount = message_data.get('tokenAmount', 0)

        # Calculate prices
        price1 = sol_in_pool / tokens_in_pool if tokens_in_pool != 0 else 0
        price2 = market_cap_sol / (10**9)
        price3 = sol_amount / token_amount if token_amount != 0 else 0

        return {
            'mint': mint,
            'price1': price1,
            'price2': price2,
            'price3': price3,
            'raw_data': {
                'solInPool': sol_in_pool,
                'tokensInPool': tokens_in_pool,
                'marketCapSol': market_cap_sol,
                'solAmount': sol_amount,
                'tokenAmount': token_amount
            }
        }
    except Exception as e:
        print(f"Error extracting trade data: {e}")
        return None


def save_price_data(price_data_dict, file_path="/home/ubuntu/009_MM_BOTS/bot007_MeteoraPUMPFUN/data/pumpswap_price_data.json"):
    """
    Save price data to JSON file with the same structure as provided example
    """
    try:
        # Create directory if it doesn't exist
        os.makedirs(os.path.dirname(file_path), exist_ok=True)

        # Create the data structure
        output_data = {
            "data": price_data_dict,
            "timeTaken": time.time() % 1,  # Fractional seconds as a simple time measure
            "fetch_timestamp": datetime.now().isoformat()
        }

        # Save to file
        with open(file_path, 'w') as f:
            json.dump(output_data, f, indent=2)

        print(f"Price data saved to: {file_path}")

    except Exception as e:
        print(f"Error saving price data: {e}")


def update_price_data(mint, price1, price_data_dict):
    """
    Update price data dictionary with new mint and price
    """
    if mint and mint != 'N/A' and price1 > 0:
        price_data_dict[mint] = {
            "id": mint,
            "type": "buyPrice",
            "price": str(price1)
        }
        return True
    return False


async def subscribe():
    uri = "wss://pumpportal.fun/api/data?api-key="+api_key

    # Dictionary to store price data for all mints
    price_data_dict = {}

    async with websockets.connect(uri) as websocket:

        # # Subscribing to trades made by accounts
        # payload = {
        #     "method": "subscribeAccountTrade",
        #     "keys": ["AArPXm8JatJiuyEffuC1un2Sc835SULa4uQqDcaGpAjV"]  # array of accounts to watch
        # }
        # await websocket.send(json.dumps(payload))

        # Subscribing to trades on tokens
        payload = {
            "method": "subscribeTokenTrade",
            "keys": ["71Jvq4Epe2FCJ7JFSF7jLXdNk1Wy4Bhqd9iL6bEFELvg"]  # array of token CAs to watch
        }
        await websocket.send(json.dumps(payload))

        async for message in websocket:
            try:
                # Parse the JSON message
                message_data = json.loads(message)

                # Print the original message
                print("=" * 80)
                print("RAW MESSAGE:")
                print(json.dumps(message_data, indent=2))

                # Extract and calculate trade data
                trade_data = extract_trade_data(message_data)

                if trade_data:
                    print("\nEXTRACTED DATA:")
                    print(f"Mint: {trade_data['mint']}")
                    print(f"Price1 (solInPool/tokensInPool): {trade_data['price1']:.12f}")
                    print(f"Price2 (marketCapSol/10^9): {trade_data['price2']:.12f}")
                    print(f"Price3 (solAmount/tokenAmount): {trade_data['price3']:.12f}")
                    print("\nRAW VALUES:")
                    for key, value in trade_data['raw_data'].items():
                        print(f"{key}: {value}")

                    # Update price data dictionary and save to JSON
                    if update_price_data(trade_data['mint'], trade_data['price1'], price_data_dict):
                        save_price_data(price_data_dict)
                        print(f"Updated price data for mint: {trade_data['mint']}")
                        print(f"Total tokens tracked: {len(price_data_dict)}")

                print("=" * 80 + "\n")

            except json.JSONDecodeError as e:
                print(f"Error parsing JSON: {e}")
            except Exception as e:
                print(f"Error processing message: {e}")

# Run the subscribe function
asyncio.get_event_loop().run_until_complete(subscribe())
