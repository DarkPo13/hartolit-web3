// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {ERC721URIStorage} from "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

/// @title  Hartolit Digital Field Passport
/// @notice Immutable on-chain certificates for agricultural drone treatments.
///         Each token binds (a) an off-chain SHA-256 payload hash of the full
///         passport JSON (farmer, treatment, telemetry, KEP signatures) to
///         (b) the IPFS URI of that JSON. Verifiers can re-hash the payload
///         and compare against `payloadHash[tokenId]` to prove non-tampering.
/// @dev    ERC-721 + URI storage + role-based minting. Tokens are
///         non-transferable by Hartolit policy — see `_update`.
contract HartolitFieldPassport is ERC721URIStorage, AccessControl {
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");

    uint256 private _nextTokenId = 1;
    bool public paused;

    /// @notice tokenId -> SHA-256 hash of the full off-chain payload
    mapping(uint256 tokenId => bytes32 hash) public payloadHash;

    /// @notice tokenId -> farmer EDRPOU or IPN (for indexing/search)
    mapping(uint256 tokenId => string id) public farmerId;

    /// @notice payload hash -> tokenId (uniqueness guard; 0 = unused)
    mapping(bytes32 hash => uint256 tokenId) public hashToTokenId;

    event PassportMinted(
        uint256 indexed tokenId,
        address indexed mintedBy,
        address indexed to,
        bytes32 payloadHash,
        string farmerId,
        string ipfsUri
    );

    event Paused(address indexed by);
    event Unpaused(address indexed by);

    error ContractPaused();
    error ZeroAddress();
    error EmptyFarmerId();
    error EmptyIpfsUri();
    error ZeroPayloadHash();
    error DuplicatePayload(bytes32 payloadHash, uint256 existingTokenId);
    error PassportsAreSoulbound();

    constructor(address admin) ERC721("Hartolit Field Passport", "HFP") {
        if (admin == address(0)) revert ZeroAddress();
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(MINTER_ROLE, admin);
        _grantRole(PAUSER_ROLE, admin);
    }

    // ---------------------------------------------------------------------
    // Mint
    // ---------------------------------------------------------------------

    /// @notice Mint a new field passport.
    /// @param to            Recipient (typically the farmer or Hartolit treasury).
    /// @param _payloadHash  SHA-256 of the full off-chain JSON payload.
    /// @param _farmerId     Farmer EDRPOU / IPN (Ukrainian tax id).
    /// @param _ipfsUri      ipfs://CID pointer to the JSON payload.
    /// @return tokenId      The newly minted token id.
    function mintPassport(
        address to,
        bytes32 _payloadHash,
        string calldata _farmerId,
        string calldata _ipfsUri
    ) external onlyRole(MINTER_ROLE) returns (uint256 tokenId) {
        if (paused) revert ContractPaused();
        if (to == address(0)) revert ZeroAddress();
        if (_payloadHash == bytes32(0)) revert ZeroPayloadHash();
        if (bytes(_farmerId).length == 0) revert EmptyFarmerId();
        if (bytes(_ipfsUri).length == 0) revert EmptyIpfsUri();

        uint256 existing = hashToTokenId[_payloadHash];
        if (existing != 0) revert DuplicatePayload(_payloadHash, existing);

        tokenId = _nextTokenId++;
        _safeMint(to, tokenId);
        _setTokenURI(tokenId, _ipfsUri);

        payloadHash[tokenId] = _payloadHash;
        farmerId[tokenId] = _farmerId;
        hashToTokenId[_payloadHash] = tokenId;

        emit PassportMinted(tokenId, msg.sender, to, _payloadHash, _farmerId, _ipfsUri);
    }

    /// @notice Next token id that will be assigned on the next mint.
    function nextTokenId() external view returns (uint256) {
        return _nextTokenId;
    }

    /// @notice Total number of passports minted so far.
    function totalMinted() external view returns (uint256) {
        return _nextTokenId - 1;
    }

    // ---------------------------------------------------------------------
    // Verification helpers
    // ---------------------------------------------------------------------

    /// @notice Returns true iff a payload with this SHA-256 hash has been minted.
    function isPayloadMinted(bytes32 _payloadHash) external view returns (bool) {
        return hashToTokenId[_payloadHash] != 0;
    }

    /// @notice Verify a payload hash against a token id.
    /// @dev    Reverts if token does not exist.
    function verifyPayload(uint256 tokenId, bytes32 candidateHash) external view returns (bool) {
        _requireOwned(tokenId);
        return payloadHash[tokenId] == candidateHash;
    }

    // ---------------------------------------------------------------------
    // Soulbound enforcement
    // ---------------------------------------------------------------------

    /// @dev Passports are non-transferable. Only mint (from = 0) is allowed.
    function _update(address to, uint256 tokenId, address auth)
        internal
        override(ERC721)
        returns (address)
    {
        address from = _ownerOf(tokenId);
        if (from != address(0) && to != address(0)) revert PassportsAreSoulbound();
        return super._update(to, tokenId, auth);
    }

    // ---------------------------------------------------------------------
    // Pause (admin emergency)
    // ---------------------------------------------------------------------

    function pause() external onlyRole(PAUSER_ROLE) {
        paused = true;
        emit Paused(msg.sender);
    }

    function unpause() external onlyRole(PAUSER_ROLE) {
        paused = false;
        emit Unpaused(msg.sender);
    }

    // ---------------------------------------------------------------------
    // ERC165
    // ---------------------------------------------------------------------

    function supportsInterface(bytes4 interfaceId)
        public
        view
        override(ERC721URIStorage, AccessControl)
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }
}
