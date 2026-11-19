// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ICompliance} from "./interfaces/ICompliance.sol";

/// @title TestAllowlistModule
/// @notice Minimal compliance module for testnet tests of CompliantERC20.
///         This is my own test module, not TokenOne's (their module implementation is not verified).
///         Rule: a wallet can send or receive only while it is on the allowlist.
///         Mint (from == 0) needs an allowlisted receiver. Burn (to == 0) needs an allowlisted sender.
contract TestAllowlistModule is ICompliance {
    address public immutable owner;
    mapping(address => bool) public isAllowlisted;

    event AllowlistSet(address indexed account, bool allowed);

    error NotOwner();

    constructor() {
        owner = msg.sender;
    }

    function setAllowlisted(address account, bool allowed) external {
        if (msg.sender != owner) revert NotOwner();
        isAllowlisted[account] = allowed;
        emit AllowlistSet(account, allowed);
    }

    function setAllowlistedBatch(address[] calldata accounts, bool allowed) external {
        if (msg.sender != owner) revert NotOwner();
        for (uint256 i = 0; i < accounts.length; i++) {
            isAllowlisted[accounts[i]] = allowed;
            emit AllowlistSet(accounts[i], allowed);
        }
    }

    function canSend(address account) public view returns (bool) {
        return isAllowlisted[account];
    }

    function canReceive(address account) public view returns (bool) {
        return isAllowlisted[account];
    }

    function canTransfer(address from, address to, uint256, uint256) external view returns (bool) {
        if (from == address(0)) return canReceive(to);
        if (to == address(0)) return canSend(from);
        return canSend(from) && canReceive(to);
    }
}
