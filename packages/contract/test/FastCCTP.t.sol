// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.8.13;

import "forge-std/Test.sol";
import "account-abstraction/interfaces/IEntryPoint.sol";
import "account-abstraction/core/EntryPoint.sol";

import "../src/DaimoFastCCTP.sol";
import "./dummy/DaimoDummyUSDC.sol";

address constant HANDOFF_ADDR = 0x5b2e4FA28b15FB6B206fb9df067EB84101340Ed9;

contract FastCCTPTest is Test {
    DaimoFastCCTP public fc = new DaimoFastCCTP{salt: 0}();

    uint256 immutable _fromChainID = 10; // Optimism
    address immutable _alice = 0xaAaAaAaaAaAaAaaAaAAAAAAAAaaaAaAaAaaAaaAa;
    IERC20 immutable _fromToken = new TestUSDC{salt: bytes32(uint256(1))}();
    uint256 immutable _fromAmount = 100;
    uint256 immutable _toChainID = 8453; // Base
    uint32 immutable _toDomain = 6; // Base
    address immutable _bob = 0xbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB;
    IERC20 immutable _toToken = new TestUSDC{salt: bytes32(uint256(2))}();
    uint256 immutable _toAmount = 99;
    uint256 immutable _nonce = 1;

    address immutable _lp = 0x2222222222222222222222222222222222222222;
    uint256 immutable _lpToTokenInitBalance = 1000;

    function testStart() public {
        vm.chainId(_fromChainID);

        DummyCCTPMessenger messenger = new DummyCCTPMessenger(
            address(_fromToken)
        );

        // Give Alice some coins
        _fromToken.transfer(_alice, 555);

        // Alice initiates a transfer
        vm.startPrank(_alice);
        _fromToken.approve(address(fc), _fromAmount);
        require(_fromToken.allowance(_alice, address(fc)) == _fromAmount);
        fc.startTransfer({
            cctpMessenger: messenger,
            fromToken: IERC20(_fromToken),
            fromAmount: _fromAmount,
            toChainID: _toChainID,
            toDomain: _toDomain,
            toAddr: _bob,
            toToken: IERC20(_toToken),
            toAmount: _toAmount,
            nonce: _nonce
        });
        vm.stopPrank();

        assertEq(messenger.amountBurned(), 100);
    }

    function testFastFinish() public {
        vm.chainId(_toChainID);

        // Seed the LP with an initial balance
        _toToken.transfer(_lp, _lpToTokenInitBalance);

        // Immediately after Alice's tx confirms, LP sends to Bob
        vm.startPrank(_lp);
        _toToken.approve(address(fc), _toAmount);
        fc.fastFinishTransfer({
            fromChainID: _fromChainID,
            fromAddr: _alice,
            fromAmount: _fromAmount,
            toAddr: _bob,
            toToken: IERC20(_toToken),
            toAmount: _toAmount,
            nonce: _nonce
        });
        vm.stopPrank();

        // LP sent funds to the recipient
        assertEq(_toToken.balanceOf(_lp), _lpToTokenInitBalance - 99);
        assertEq(_toToken.balanceOf(_bob), 99);
    }

    function testClaim() public {
        testFastFinish();

        // Wait for CCTP to relay the message
        vm.warp(block.timestamp + 20 minutes);

        // CCTP receiveMessage() sends funds to the handoff address
        _toToken.transfer(HANDOFF_ADDR, _fromAmount);

        // Then, LP claims the funds
        vm.prank(_lp);
        fc.claimTransfer({
            fromChainID: _fromChainID,
            fromAddr: _alice,
            fromAmount: _fromAmount,
            toAddr: _bob,
            toAmount: _toAmount,
            toToken: IERC20(_toToken),
            nonce: _nonce
        });

        // LP received funds from handoff, is now net up the tip = 1 unit
        assertEq(_toToken.balanceOf(HANDOFF_ADDR), 0);
        assertEq(_toToken.balanceOf(_lp), _lpToTokenInitBalance + 1);
        assertEq(_toToken.balanceOf(_bob), 99);
    }

    function testGetHandoffAddr() public view {
        address actual = fc.getHandoffAddr(
            _fromChainID,
            _alice,
            _fromAmount,
            _toChainID,
            _bob,
            IERC20(_toToken),
            _toAmount,
            _nonce
        );
        console.log("actual**", actual);

        assertEq(actual, HANDOFF_ADDR);
    }
}

contract DummyCCTPMessenger is ICCTPTokenMessenger, Test {
    address public immutable expectedBurnToken;
    uint256 public amountBurned;

    constructor(address burnToken) {
        expectedBurnToken = burnToken;
    }

    function depositForBurn(
        uint256 amount,
        uint32 destinationDomain,
        bytes32 mintRecipient,
        address burnToken
    ) external returns (uint64 _nonce) {
        assertEq(amount, 100);
        assertEq(destinationDomain, 6);
        address expectedRecipient = HANDOFF_ADDR;
        assertEq(mintRecipient, bytes32(uint256(uint160(expectedRecipient))));
        assertEq(burnToken, expectedBurnToken);

        // Burn it
        IERC20(burnToken).transferFrom(msg.sender, address(0xdead), amount);
        amountBurned += amount;

        return 0;
    }
}
