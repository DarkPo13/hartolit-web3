// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {HartolitFieldPassport} from "../src/HartolitFieldPassport.sol";

contract Deploy is Script {
    function run() external returns (HartolitFieldPassport passport) {
        uint256 deployerKey = vm.envUint("ADMIN_PRIVATE_KEY");
        address admin = vm.addr(deployerKey);

        console2.log("Deployer / admin:", admin);
        console2.log("Chain id:", block.chainid);

        vm.startBroadcast(deployerKey);
        passport = new HartolitFieldPassport(admin);
        vm.stopBroadcast();

        console2.log("HartolitFieldPassport deployed at:", address(passport));
    }
}
