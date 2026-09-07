// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { AaveV3Monad } from "@aave-address-book/AaveV3Monad.sol";
import { IPool } from "@aave-address-book/AaveV3.sol";
import { HandlerBase } from "./HandlerBase.sol";

/// @title Aave v3 Action Handler
/// @notice Supplies underlying assets to, withdraws them from, or repays debt on Aave v3 on Monad.
contract HandlerAaveV3 is HandlerBase {
    using SafeERC20 for IERC20;

    IPool public constant POOL = AaveV3Monad.POOL;

    /// @dev Aave v3.2 removed stable borrowing; on Monad
    ///      `PoolDataProvider.getReserveTokensAddresses(USDC)` returns
    ///      `stableDebtTokenAddress = 0x0`, so variable is the only mode this Pool accepts.
    uint256 public constant VARIABLE_RATE_MODE = 2;

    /// @notice Supplies `amount` on behalf of the executor.
    function supply(address asset, uint256 amount) external {
        uint256 resolved = _resolveAmount(asset, amount);
        address aToken = POOL.getReserveData(asset).aTokenAddress;
        _trackToken(asset);
        _trackToken(aToken);
        IERC20(asset).forceApprove(address(POOL), resolved);
        _trackApproval(asset, address(POOL));
        POOL.supply(asset, resolved, address(this), 0);
    }

    /// @notice Withdraws `amount`; max uint requests the full Aave position.
    function withdraw(address asset, uint256 amount) external returns (uint256 withdrawn) {
        address aToken = POOL.getReserveData(asset).aTokenAddress;
        _trackToken(asset);
        _trackToken(aToken);
        withdrawn = POOL.withdraw(asset, amount, address(this));
    }

    /// @notice Repays the combo sender's variable-rate debt; max uint spends the executor's
    ///         whole `asset` balance. Aave caps the payment at the outstanding debt.
    function repay(address asset, uint256 amount) external returns (uint256 repaid) {
        uint256 resolved = _resolveAmount(asset, amount);
        // The variable debt token is non-transferable and the executor never holds a balance
        // of it, so only the underlying is tracked.
        _trackToken(asset);
        IERC20(asset).forceApprove(address(POOL), resolved);
        _trackApproval(asset, address(POOL));
        repaid = POOL.repay(asset, resolved, VARIABLE_RATE_MODE, _comboSender());
        // Cleared here rather than only at post-process so the residual-allowance window is
        // bounded to the single Pool call.
        IERC20(asset).forceApprove(address(POOL), 0);
    }
}
