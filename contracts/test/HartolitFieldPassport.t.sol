// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, console2} from "forge-std/Test.sol";
import {HartolitFieldPassport} from "../src/HartolitFieldPassport.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {IERC721Errors} from "@openzeppelin/contracts/interfaces/draft-IERC6093.sol";

contract HartolitFieldPassportTest is Test {
    HartolitFieldPassport internal passport;

    address internal admin = makeAddr("admin");
    address internal minter = makeAddr("minter");
    address internal farmer = makeAddr("farmer");
    address internal stranger = makeAddr("stranger");

    bytes32 internal constant HASH_A = keccak256("payload-a");
    bytes32 internal constant HASH_B = keccak256("payload-b");
    string internal constant FARMER_ID = "12345678";
    string internal constant IPFS_URI = "ipfs://bafybeigdyrabc";

    event PassportMinted(
        uint256 indexed tokenId,
        address indexed mintedBy,
        address indexed to,
        bytes32 payloadHash,
        string farmerId,
        string ipfsUri
    );

    function setUp() public {
        vm.prank(admin);
        passport = new HartolitFieldPassport(admin);
    }

    // ---------------------------------------------------------------------
    // Constructor
    // ---------------------------------------------------------------------

    function test_Constructor_GrantsAllRolesToAdmin() public view {
        assertTrue(passport.hasRole(passport.DEFAULT_ADMIN_ROLE(), admin));
        assertTrue(passport.hasRole(passport.MINTER_ROLE(), admin));
        assertTrue(passport.hasRole(passport.PAUSER_ROLE(), admin));
    }

    function test_Constructor_RevertsOnZeroAddress() public {
        vm.expectRevert(HartolitFieldPassport.ZeroAddress.selector);
        new HartolitFieldPassport(address(0));
    }

    function test_NameAndSymbol() public view {
        assertEq(passport.name(), "Hartolit Field Passport");
        assertEq(passport.symbol(), "HFP");
    }

    // ---------------------------------------------------------------------
    // Mint
    // ---------------------------------------------------------------------

    function test_Mint_HappyPath() public {
        vm.expectEmit(true, true, true, true);
        emit PassportMinted(1, admin, farmer, HASH_A, FARMER_ID, IPFS_URI);

        vm.prank(admin);
        uint256 tokenId = passport.mintPassport(farmer, HASH_A, FARMER_ID, IPFS_URI);

        assertEq(tokenId, 1);
        assertEq(passport.ownerOf(1), farmer);
        assertEq(passport.tokenURI(1), IPFS_URI);
        assertEq(passport.payloadHash(1), HASH_A);
        assertEq(passport.farmerId(1), FARMER_ID);
        assertEq(passport.hashToTokenId(HASH_A), 1);
        assertEq(passport.totalMinted(), 1);
        assertEq(passport.nextTokenId(), 2);
    }

    function test_Mint_IncrementsTokenIds() public {
        vm.startPrank(admin);
        uint256 id1 = passport.mintPassport(farmer, HASH_A, "id-1", "ipfs://1");
        uint256 id2 = passport.mintPassport(farmer, HASH_B, "id-2", "ipfs://2");
        vm.stopPrank();

        assertEq(id1, 1);
        assertEq(id2, 2);
        assertEq(passport.totalMinted(), 2);
    }

    function test_Mint_RevertsWithoutMinterRole() public {
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector,
                stranger,
                passport.MINTER_ROLE()
            )
        );
        vm.prank(stranger);
        passport.mintPassport(farmer, HASH_A, FARMER_ID, IPFS_URI);
    }

    function test_Mint_RevertsOnZeroAddressRecipient() public {
        vm.expectRevert(HartolitFieldPassport.ZeroAddress.selector);
        vm.prank(admin);
        passport.mintPassport(address(0), HASH_A, FARMER_ID, IPFS_URI);
    }

    function test_Mint_RevertsOnZeroHash() public {
        vm.expectRevert(HartolitFieldPassport.ZeroPayloadHash.selector);
        vm.prank(admin);
        passport.mintPassport(farmer, bytes32(0), FARMER_ID, IPFS_URI);
    }

    function test_Mint_RevertsOnEmptyFarmerId() public {
        vm.expectRevert(HartolitFieldPassport.EmptyFarmerId.selector);
        vm.prank(admin);
        passport.mintPassport(farmer, HASH_A, "", IPFS_URI);
    }

    function test_Mint_RevertsOnEmptyIpfsUri() public {
        vm.expectRevert(HartolitFieldPassport.EmptyIpfsUri.selector);
        vm.prank(admin);
        passport.mintPassport(farmer, HASH_A, FARMER_ID, "");
    }

    function test_Mint_RevertsOnDuplicateHash() public {
        vm.prank(admin);
        passport.mintPassport(farmer, HASH_A, FARMER_ID, IPFS_URI);

        vm.expectRevert(
            abi.encodeWithSelector(HartolitFieldPassport.DuplicatePayload.selector, HASH_A, 1)
        );
        vm.prank(admin);
        passport.mintPassport(farmer, HASH_A, "other-id", "ipfs://other");
    }

    function test_Mint_RevertsWhenPaused() public {
        vm.prank(admin);
        passport.pause();

        vm.expectRevert(HartolitFieldPassport.ContractPaused.selector);
        vm.prank(admin);
        passport.mintPassport(farmer, HASH_A, FARMER_ID, IPFS_URI);
    }

    // ---------------------------------------------------------------------
    // Soulbound transfers
    // ---------------------------------------------------------------------

    function test_Transfer_Reverts() public {
        vm.prank(admin);
        passport.mintPassport(farmer, HASH_A, FARMER_ID, IPFS_URI);

        vm.expectRevert(HartolitFieldPassport.PassportsAreSoulbound.selector);
        vm.prank(farmer);
        passport.transferFrom(farmer, stranger, 1);
    }

    function test_SafeTransfer_Reverts() public {
        vm.prank(admin);
        passport.mintPassport(farmer, HASH_A, FARMER_ID, IPFS_URI);

        vm.expectRevert(HartolitFieldPassport.PassportsAreSoulbound.selector);
        vm.prank(farmer);
        passport.safeTransferFrom(farmer, stranger, 1);
    }

    // ---------------------------------------------------------------------
    // Verification helpers
    // ---------------------------------------------------------------------

    function test_IsPayloadMinted() public {
        assertFalse(passport.isPayloadMinted(HASH_A));

        vm.prank(admin);
        passport.mintPassport(farmer, HASH_A, FARMER_ID, IPFS_URI);

        assertTrue(passport.isPayloadMinted(HASH_A));
        assertFalse(passport.isPayloadMinted(HASH_B));
    }

    function test_VerifyPayload_True() public {
        vm.prank(admin);
        passport.mintPassport(farmer, HASH_A, FARMER_ID, IPFS_URI);

        assertTrue(passport.verifyPayload(1, HASH_A));
        assertFalse(passport.verifyPayload(1, HASH_B));
    }

    function test_VerifyPayload_RevertsForNonexistentToken() public {
        vm.expectRevert(abi.encodeWithSelector(IERC721Errors.ERC721NonexistentToken.selector, 999));
        passport.verifyPayload(999, HASH_A);
    }

    // ---------------------------------------------------------------------
    // Pause
    // ---------------------------------------------------------------------

    function test_Pause_RevertsForNonPauser() public {
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector,
                stranger,
                passport.PAUSER_ROLE()
            )
        );
        vm.prank(stranger);
        passport.pause();
    }

    function test_PauseAndUnpause() public {
        vm.startPrank(admin);
        passport.pause();
        assertTrue(passport.paused());
        passport.unpause();
        assertFalse(passport.paused());
        vm.stopPrank();
    }

    // ---------------------------------------------------------------------
    // Role management
    // ---------------------------------------------------------------------

    function test_GrantMinterRole() public {
        vm.prank(admin);
        passport.grantRole(passport.MINTER_ROLE(), minter);

        vm.prank(minter);
        uint256 tokenId = passport.mintPassport(farmer, HASH_A, FARMER_ID, IPFS_URI);
        assertEq(tokenId, 1);
    }

    // ---------------------------------------------------------------------
    // ERC165
    // ---------------------------------------------------------------------

    function test_SupportsInterface_ERC721() public view {
        // ERC721
        assertTrue(passport.supportsInterface(0x80ac58cd));
        // ERC721Metadata
        assertTrue(passport.supportsInterface(0x5b5e139f));
        // AccessControl
        assertTrue(passport.supportsInterface(0x7965db0b));
        // ERC165
        assertTrue(passport.supportsInterface(0x01ffc9a7));
    }

    // ---------------------------------------------------------------------
    // Fuzz
    // ---------------------------------------------------------------------

    function testFuzz_Mint_UniqueHashes(bytes32 hashA, bytes32 hashB) public {
        vm.assume(hashA != bytes32(0));
        vm.assume(hashB != bytes32(0));
        vm.assume(hashA != hashB);

        vm.startPrank(admin);
        uint256 id1 = passport.mintPassport(farmer, hashA, "f1", "ipfs://a");
        uint256 id2 = passport.mintPassport(farmer, hashB, "f2", "ipfs://b");
        vm.stopPrank();

        assertEq(id1, 1);
        assertEq(id2, 2);
        assertTrue(passport.verifyPayload(id1, hashA));
        assertTrue(passport.verifyPayload(id2, hashB));
        assertFalse(passport.verifyPayload(id1, hashB));
    }
}
