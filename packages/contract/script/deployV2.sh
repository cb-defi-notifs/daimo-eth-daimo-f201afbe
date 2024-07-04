#!/bin/bash
set -e

# Requirements
# RPC_URL for the target chain 
# PRIVATE_KEY for the deployer
# ETHERSCAN_API_KEY for the target chain

# Build
forge build --via-ir

# Deploy USDC Swapper
forge script script/DeployDaimoFlexSwapper.s.sol --sig "run" --fork-url $RPC_URL --private-key $PRIVATE_KEY --broadcast --verify  --etherscan-api-key $ETHERSCAN_API_KEY --via-ir

# Deploy CCTP Bridger
forge script script/DeployDaimoCCTPBridger.s.sol --sig "run" --fork-url $RPC_URL --private-key $PRIVATE_KEY --broadcast --verify  --etherscan-api-key $ETHERSCAN_API_KEY --via-ir

# Deploy Account Factory V2
forge script script/DeployAccountFactoryV2.s.sol --sig "run" --fork-url $RPC_URL --private-key $PRIVATE_KEY --broadcast --verify --etherscan-api-key $ETHERSCAN_API_KEY --via-ir

# Deploy Account V2 test account
# Requirements: addresses for the deployed factory, swapper, and bridger
forge script script/DeployTestAccountV2.s.sol --sig "run" --fork-url $RPC_URL --private-key $PRIVATE_KEY --broadcast --verify --etherscan-api-key $ETHERSCAN_API_KEY
