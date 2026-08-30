// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import { Test } from "forge-std/Test.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { AaveV3Monad } from "@aave-address-book/AaveV3Monad.sol";
import { Executor } from "../src/Executor.sol";
import { HandlerAaveV3 } from "../src/HandlerAaveV3.sol";
import { Registry } from "../src/Registry.sol";

contract MockERC20 {
    mapping(address account => uint256) public balanceOf;
    mapping(address owner => mapping(address spender => uint256)) public allowance;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}

/// @dev Stands in for the Aave Pool at `AaveV3Monad.POOL` via `vm.etch`. Mirrors the two
///      `validateRepay` behaviors the handler relies on: a zero amount or zero debt reverts,
///      and the payment is capped at the borrower's outstanding debt.
contract MockAavePool {
    mapping(address borrower => uint256) public debtOf;
    address public lastAsset;
    uint256 public lastAmount;
    uint256 public lastRateMode;
    address public lastOnBehalfOf;
    uint256 public allowanceAtCall;

    function setDebt(address borrower, uint256 amount) external {
        debtOf[borrower] = amount;
    }

    function repay(address asset, uint256 amount, uint256 interestRateMode, address onBehalfOf)
        external
        returns (uint256)
    {
        uint256 debt = debtOf[onBehalfOf];
        require(amount != 0 && debt != 0, "mock: validateRepay");
        lastAsset = asset;
        lastAmount = amount;
        lastRateMode = interestRateMode;
        lastOnBehalfOf = onBehalfOf;
        allowanceAtCall = IERC20(asset).allowance(msg.sender, address(this));
        uint256 paid = amount < debt ? amount : debt;
        debtOf[onBehalfOf] = debt - paid;
        bool pulled = IERC20(asset).transferFrom(msg.sender, address(this), paid);
        require(pulled, "mock: pull failed");
        return paid;
    }
}

contract HandlerAaveV3RepayTest is Test {
    Executor internal executor;
    HandlerAaveV3 internal handler;
    Registry internal registry;
    MockERC20 internal usdc;
    MockAavePool internal pool;
    address internal wallet = makeAddr("wallet");

    function setUp() public {
        registry = new Registry(address(this));
        executor = new Executor(address(registry), address(this));
        handler = new HandlerAaveV3();
        registry.setHandler(address(handler), true);
        usdc = new MockERC20();
        vm.etch(address(AaveV3Monad.POOL), address(new MockAavePool()).code);
        pool = MockAavePool(address(AaveV3Monad.POOL));
    }

    function _repay(uint256 amount) internal {
        address[] memory handlers = new address[](1);
        bytes[] memory datas = new bytes[](1);
        handlers[0] = address(handler);
        datas[0] = abi.encodeCall(HandlerAaveV3.repay, (address(usdc), amount));
        vm.prank(wallet);
        executor.execute(handlers, datas);
    }

    function testRepayClearsDebtOnBehalfOfComboSender() public {
        usdc.mint(address(executor), 60e6);
        pool.setDebt(wallet, 60e6);

        _repay(60e6);

        assertEq(pool.lastAsset(), address(usdc));
        assertEq(pool.lastRateMode(), handler.VARIABLE_RATE_MODE());
        assertEq(
            pool.lastOnBehalfOf(), wallet, "debt must be repaid for the wallet, not the executor"
        );
        assertEq(pool.debtOf(wallet), 0);
        assertEq(usdc.balanceOf(address(executor)), 0);
    }

    function testRepayApprovesExactlyAndClearsApproval() public {
        usdc.mint(address(executor), 80e6);
        pool.setDebt(wallet, 80e6);

        _repay(80e6);

        assertEq(pool.allowanceAtCall(), 80e6, "the Pool sees one exact approval");
        assertEq(usdc.allowance(address(executor), address(pool)), 0, "no allowance survives");
    }

    function testRepayMaxSentinelSpendsExecutorBalance() public {
        usdc.mint(address(executor), 70e6);
        pool.setDebt(wallet, 100e6);

        _repay(type(uint256).max);

        assertEq(
            pool.lastAmount(), 70e6, "max resolves to the executor balance before the Pool call"
        );
        assertEq(pool.debtOf(wallet), 30e6);
        assertEq(usdc.balanceOf(address(executor)), 0);
    }

    function testRepayOvershootReturnsSurplusToWallet() public {
        usdc.mint(address(executor), 100e6);
        pool.setDebt(wallet, 60e6);

        _repay(100e6);

        assertEq(pool.debtOf(wallet), 0);
        assertEq(usdc.balanceOf(address(pool)), 60e6, "Aave pulls only the outstanding debt");
        assertEq(usdc.balanceOf(wallet), 40e6, "post-process sweeps the unspent principal home");
        assertEq(usdc.balanceOf(address(executor)), 0);
        assertEq(usdc.allowance(address(executor), address(pool)), 0);
    }

    function testRepayRevertsWhenThereIsNothingToRepay() public {
        usdc.mint(address(executor), 50e6);

        address[] memory handlers = new address[](1);
        bytes[] memory datas = new bytes[](1);
        handlers[0] = address(handler);
        datas[0] = abi.encodeCall(HandlerAaveV3.repay, (address(usdc), 50e6));
        vm.prank(wallet);
        vm.expectRevert(bytes("mock: validateRepay"));
        executor.execute(handlers, datas);
    }
}
