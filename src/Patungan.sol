// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IQieDexRouter} from "./interfaces/IQieDexRouter.sol";
import {IQieZone} from "./interfaces/IQieZone.sol";
import {IAggregatorV3} from "./interfaces/IAggregatorV3.sol";

/// @title Patungan: group-buy escrow for QIE mainnet
/// @notice An organizer opens a pool (seats x price in QUSDC, a deadline, a payee). Members pay their seats in QUSDC,
/// or in native QIE that this contract swaps to QUSDC through QIEDEX in the same transaction. The transaction that
/// fills the last seat pays the payee the whole amount. A pool that misses its deadline (or is cancelled by its
/// organizer) refunds every member in QUSDC.
/// @dev No owner, no pause, no upgrade, no sweep: QUSDC leaves this contract only to a pool's payee (last seat) or to
/// a member (refund). The QIE Oracle is a sanity bound on the swap, never the price paid (the bound assumes
/// 1 QUSDC = 1 USD).
contract Patungan is ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ------------------------------------------------------------------ types
    enum Status {
        Open,
        Paid,
        Cancelled
    }

    /// @dev "Expired" is derived: Open && block.timestamp >= deadline (a full pool is always Paid).
    struct Pool {
        address organizer;
        address payee; // snapshotted at create
        uint96 price; // QUSDC base units per seat
        uint40 deadline; // unix seconds
        uint16 seats; // MIN_SEATS..MAX_SEATS
        uint16 filled; // 0..seats
        Status status;
        uint128 held; // QUSDC escrowed for this pool: += join, -= refund, = 0 on payout
    }

    struct Meta {
        string title;
        string payeeName; // empty for address pools
    }

    // ------------------------------------------------------------------ constants
    uint16 public constant MIN_SEATS = 2;
    uint16 public constant MAX_SEATS = 100;
    uint256 public constant MAX_TITLE_BYTES = 64;
    uint256 public constant MAX_NAME_BYTES = 64;
    uint256 public constant MIN_DURATION = 10 minutes;
    uint256 public constant MAX_DURATION = 90 days;
    uint256 public constant MAX_DEV_BPS_CAP = 2_000;
    string internal constant TLD = "qie";

    // ------------------------------------------------------------------ immutables
    IERC20 public immutable qusdc;
    IQieDexRouter public immutable router;
    IQieZone public immutable zone;
    IAggregatorV3 public immutable oracle;
    address public immutable wqie;
    /// @notice One-sided guard: the QIE a member pays may exceed Oracle fair value by at most this many bps.
    uint256 public immutable maxDevBps;
    /// @notice The QIE path reverts OracleStale when the feed's updatedAt is older than this (seconds).
    uint256 public immutable maxOracleAge;
    uint8 public immutable oracleDecimals;
    uint8 public immutable qusdcDecimals;
    uint256 private immutable _scaleNum;
    uint256 private immutable _scaleDen;

    // ------------------------------------------------------------------ storage
    uint256 public nextId;
    mapping(uint256 => Pool) public pools;
    mapping(uint256 => address[]) internal members;
    mapping(uint256 => mapping(address => uint256)) public paid;
    mapping(uint256 => mapping(address => uint16)) public seatsOf;
    mapping(uint256 => Meta) internal meta;
    mapping(uint256 => uint256) public refundedCount;
    /// @notice Sum of every pool's `held`. isSolvent() compares it with the contract's QUSDC balance.
    uint256 public totalHeld;

    // ------------------------------------------------------------------ events
    event PoolCreated(
        uint256 indexed id,
        address indexed organizer,
        address indexed payee,
        string payeeName,
        uint96 price,
        uint16 seats,
        uint40 deadline,
        string title
    );
    event Joined(
        uint256 indexed id,
        address indexed member,
        uint16 n,
        uint256 amount,
        bool paidWithQIE,
        uint256 qieSpent,
        uint256 oraclePrice
    );
    event PoolPaid(uint256 indexed id, address indexed payee, uint256 total);
    event PoolCancelled(uint256 indexed id);
    event Refunded(uint256 indexed id, address indexed member, uint256 amount);
    event RefundFailed(uint256 indexed id, address indexed member, uint256 amount);

    // ------------------------------------------------------------------ errors
    error BadParams();
    error PayeeInvalid();
    error PayeeNotFound();
    error PayeeChanged(address resolved);
    error PoolNotOpen();
    error TooManySeats();
    error TransferShort();
    error ValueTooLow(uint256 needed, uint256 sent);
    error PriceDeviation(uint256 fairQie, uint256 qieIn);
    error OracleStale(uint256 updatedAt);
    error OracleBadPrice();
    error SwapShort();
    error ForwardFailed();
    error QuoteExpired();
    error NotRefundable();
    error NothingToRefund();
    error NotOrganizer();
    error OnlyRouter();

    constructor(
        IERC20 qusdc_,
        IQieDexRouter router_,
        IQieZone zone_,
        IAggregatorV3 oracle_,
        uint256 maxDevBps_,
        uint256 maxOracleAge_
    ) {
        if (maxDevBps_ == 0 || maxDevBps_ > MAX_DEV_BPS_CAP || maxOracleAge_ == 0) {
            revert BadParams();
        }
        (qusdc, router, zone, oracle, maxDevBps, maxOracleAge) =
        (qusdc_, router_, zone_, oracle_, maxDevBps_, maxOracleAge_);
        wqie = router_.WETH();
        uint8 od = oracle_.decimals();
        uint8 qd = IERC20Metadata(address(qusdc_)).decimals();
        (oracleDecimals, qusdcDecimals) = (od, qd);
        // fairQie (18 dp) = amount (qd) * 10^(od + 18 - qd) / answer (od)
        if (uint256(od) + 18 >= qd) (_scaleNum, _scaleDen) = (10 ** (uint256(od) + 18 - qd), 1);
        else (_scaleNum, _scaleDen) = (1, 10 ** (qd - uint256(od) - 18));
    }

    // ------------------------------------------------------------------ create
    /// @notice Open a pool that pays `payee` (an address) when its last seat is paid.
    function createPool(address payee, uint96 price, uint16 seats, uint40 deadline, string calldata title)
        external
        nonReentrant
        returns (uint256 id)
    {
        id = _create(payee, "", price, seats, deadline, title);
    }

    /// @notice Open a pool whose payee is the current owner of the `.qie` name `name` (lowercase label, no ".qie").
    /// The owner is snapshotted now; a later transfer of the name never redirects the money.
    /// @param expectedPayee The address the create form showed; reverts PayeeChanged if the name resolves elsewhere.
    function createPoolByName(
        string calldata name,
        address expectedPayee,
        uint96 price,
        uint16 seats,
        uint40 deadline,
        string calldata title
    ) external nonReentrant returns (uint256 id) {
        if (bytes(name).length == 0 || bytes(name).length > MAX_NAME_BYTES) revert BadParams();
        if (!zone.domainExistsByName(name, TLD)) revert PayeeNotFound();
        address resolved = zone.domainOwnerByName(name, TLD);
        if (resolved == address(0)) revert PayeeNotFound();
        if (resolved != expectedPayee) revert PayeeChanged(resolved);
        id = _create(resolved, name, price, seats, deadline, title);
    }

    // ------------------------------------------------------------------ join
    /// @notice Pay `n` seats in QUSDC (needs an approve of n * price first).
    function join(uint256 id, uint16 n) external nonReentrant {
        Pool storage p = _openPool(id);
        uint256 amount = _checkSeats(p, n);
        uint256 before = qusdc.balanceOf(address(this));
        qusdc.safeTransferFrom(msg.sender, address(this), amount);
        if (qusdc.balanceOf(address(this)) - before < amount) revert TransferShort();
        emit Joined(id, msg.sender, n, amount, false, 0, 0);
        _seat(id, p, msg.sender, n, amount);
    }

    /// @notice Pay `n` seats in native QIE: the contract swaps exactly n * price QUSDC out of QIEDEX, returns the
    /// unspent QIE to the caller in the same transaction, and seats the caller.
    /// @dev msg.value is the member's maximum. Reverts PriceDeviation if QIEDEX would charge more than Oracle fair
    /// value * (10_000 + maxDevBps) / 10_000, and QuoteExpired after `expiry`.
    function joinWithQIE(uint256 id, uint16 n, uint40 expiry) external payable nonReentrant {
        if (block.timestamp > expiry) revert QuoteExpired();
        Pool storage p = _openPool(id);
        uint256 amount = _checkSeats(p, n);
        (uint256 qieSpent, uint256 oraclePrice) = _swapIn(amount);
        emit Joined(id, msg.sender, n, amount, true, qieSpent, oraclePrice);
        _seat(id, p, msg.sender, n, amount);
        uint256 change = msg.value - qieSpent;
        if (change > 0) {
            (bool ok,) = msg.sender.call{value: change}("");
            if (!ok) revert ForwardFailed();
        }
    }

    // ------------------------------------------------------------------ refunds + cancel
    /// @notice After the deadline (unfilled) or a cancel: send the caller their QUSDC back.
    function claimRefund(uint256 id) external nonReentrant {
        if (!isRefundable(id)) revert NotRefundable();
        uint256 amount = paid[id][msg.sender];
        if (amount == 0) revert NothingToRefund();
        _debit(id, msg.sender, amount);
        refundedCount[id] += 1;
        emit Refunded(id, msg.sender, amount);
        qusdc.safeTransfer(msg.sender, amount);
    }

    /// @notice Push refunds to members[from .. from + count). Anyone may call. Members already refunded are skipped;
    /// a failed transfer leaves that member's balance claimable and emits RefundFailed.
    function refundAll(uint256 id, uint256 from, uint256 count) external nonReentrant {
        if (!isRefundable(id)) revert NotRefundable();
        address[] storage list = members[id];
        uint256 end = _end(list.length, from, count);
        for (uint256 i = from; i < end; ++i) {
            address m = list[i];
            uint256 amount = paid[id][m];
            if (amount == 0) continue;
            _debit(id, m, amount);
            bool ok;
            try qusdc.transfer(m, amount) returns (bool r) {
                ok = r;
            } catch {}
            if (ok) {
                refundedCount[id] += 1;
                emit Refunded(id, m, amount);
            } else {
                _credit(id, m, amount);
                emit RefundFailed(id, m, amount);
            }
        }
    }

    /// @notice Organizer closes a pool before its deadline. With members, refunds open at once.
    function cancel(uint256 id) external nonReentrant {
        Pool storage p = _openPool(id);
        if (msg.sender != p.organizer) revert NotOrganizer();
        p.status = Status.Cancelled;
        emit PoolCancelled(id);
    }

    /// @dev Native QIE is accepted only from the router (the exact-out swap returns the unspent input).
    receive() external payable {
        if (msg.sender != address(router)) revert OnlyRouter();
    }

    // ------------------------------------------------------------------ views
    function getPool(uint256 id)
        external
        view
        returns (
            Pool memory pool,
            string memory title,
            string memory payeeName,
            uint256 memberCount,
            uint256 refunded,
            bool refundable
        )
    {
        pool = pools[id];
        Meta storage m = meta[id];
        return (pool, m.title, m.payeeName, members[id].length, refundedCount[id], isRefundable(id));
    }

    function getMembers(uint256 id, uint256 from, uint256 count)
        external
        view
        returns (address[] memory addrs, uint16[] memory seats, uint256[] memory owed)
    {
        address[] storage list = members[id];
        uint256 end = _end(list.length, from, count);
        uint256 len = end > from ? end - from : 0;
        addrs = new address[](len);
        seats = new uint16[](len);
        owed = new uint256[](len);
        for (uint256 i; i < len; ++i) {
            address a = list[from + i];
            (addrs[i], seats[i], owed[i]) = (a, seatsOf[id][a], paid[id][a]);
        }
    }

    /// @notice What `joinWithQIE(id, n, …)` would pay now: the router's quote, the Oracle fair value, and the most the
    /// guard allows. Reverts OracleStale / OracleBadPrice like the join itself (the UI then hides the QIE path).
    function quoteQIE(uint256 id, uint16 n)
        external
        view
        returns (uint256 qieIn, uint256 oracleFairQie, uint256 maxAllowedQie)
    {
        uint256 amount = uint256(pools[id].price) * n;
        if (amount == 0) revert BadParams();
        (oracleFairQie,) = _fairQie(amount);
        maxAllowedQie = oracleFairQie * (10_000 + maxDevBps) / 10_000;
        qieIn = router.getAmountsIn(amount, _path())[0];
    }

    /// @notice True after the deadline of an unfilled pool, or once its organizer cancelled it.
    function isRefundable(uint256 id) public view returns (bool) {
        Pool storage p = pools[id];
        if (p.organizer == address(0)) return false;
        return p.status == Status.Cancelled || (p.status == Status.Open && block.timestamp >= p.deadline);
    }

    /// @notice The contract holds at least the QUSDC it owes (≥: anyone can send QUSDC here directly).
    function isSolvent() external view returns (bool) {
        return qusdc.balanceOf(address(this)) >= totalHeld;
    }

    // ------------------------------------------------------------------ internals
    function _create(
        address payee,
        string memory payeeName,
        uint96 price,
        uint16 seats,
        uint40 deadline,
        string calldata title
    ) private returns (uint256 id) {
        if (payee == address(0) || payee == address(this)) revert PayeeInvalid();
        if (
            price == 0 || seats < MIN_SEATS || seats > MAX_SEATS || deadline < block.timestamp + MIN_DURATION
                || deadline > block.timestamp + MAX_DURATION || bytes(title).length > MAX_TITLE_BYTES
        ) revert BadParams();
        id = ++nextId;
        pools[id] = Pool({
            organizer: msg.sender,
            payee: payee,
            price: price,
            deadline: deadline,
            seats: seats,
            filled: 0,
            status: Status.Open,
            held: 0
        });
        meta[id] = Meta(title, payeeName);
        emit PoolCreated(id, msg.sender, payee, payeeName, price, seats, deadline, title);
    }

    function _openPool(uint256 id) private view returns (Pool storage p) {
        p = pools[id];
        if (p.organizer == address(0) || p.status != Status.Open || block.timestamp >= p.deadline) {
            revert PoolNotOpen();
        }
    }

    function _checkSeats(Pool storage p, uint16 n) private view returns (uint256 amount) {
        if (n == 0) revert BadParams();
        if (uint256(p.filled) + n > p.seats) revert TooManySeats();
        amount = uint256(p.price) * n;
    }

    /// @dev Swap exactly `amount` QUSDC out of QIEDEX for at most min(msg.value, Oracle ceiling) QIE.
    function _swapIn(uint256 amount) private returns (uint256 qieSpent, uint256 oraclePrice) {
        uint256 fairQie;
        (fairQie, oraclePrice) = _fairQie(amount);
        uint256 ceiling = fairQie * (10_000 + maxDevBps) / 10_000;
        address[] memory path = _path();
        uint256 qieIn = router.getAmountsIn(amount, path)[0];
        if (qieIn > ceiling) revert PriceDeviation(fairQie, qieIn);
        if (msg.value < qieIn) revert ValueTooLow(qieIn, msg.value);

        uint256 nativeBefore = address(this).balance;
        uint256 qusdcBefore = qusdc.balanceOf(address(this));
        router.swapETHForExactTokens{value: Math.min(msg.value, ceiling)}(amount, path, address(this), block.timestamp);
        if (qusdc.balanceOf(address(this)) - qusdcBefore < amount) revert SwapShort();
        qieSpent = nativeBefore - address(this).balance;
        if (qieSpent > ceiling) revert PriceDeviation(fairQie, qieSpent);
    }

    /// @dev Oracle fair value in QIE (18 dp) of `amount` QUSDC, rounded up. Assumes 1 QUSDC = 1 USD.
    function _fairQie(uint256 amount) private view returns (uint256 fairQie, uint256 price) {
        (, int256 answer,, uint256 updatedAt,) = oracle.latestRoundData();
        if (answer <= 0) revert OracleBadPrice();
        if (block.timestamp > updatedAt && block.timestamp - updatedAt > maxOracleAge) revert OracleStale(updatedAt);
        price = uint256(answer);
        fairQie = Math.mulDiv(amount, _scaleNum, price * _scaleDen, Math.Rounding.Ceil);
    }

    function _seat(uint256 id, Pool storage p, address member, uint16 n, uint256 amount) private {
        if (seatsOf[id][member] == 0) members[id].push(member);
        seatsOf[id][member] += n;
        paid[id][member] += amount;
        p.filled += n;
        // forge-lint: disable-next-line(unsafe-typecast) -- amount <= price (uint96) * seats (uint16) < 2^112
        p.held += uint128(amount);
        totalHeld += amount;
        if (p.filled == p.seats) {
            uint256 total = p.held;
            p.status = Status.Paid;
            p.held = 0;
            totalHeld -= total;
            emit PoolPaid(id, p.payee, total);
            qusdc.safeTransfer(p.payee, total); // the last seat pays the payee in the same transaction
        }
    }

    function _debit(uint256 id, address m, uint256 amount) private {
        paid[id][m] = 0;
        // forge-lint: disable-next-line(unsafe-typecast) -- amount <= price (uint96) * seats (uint16) < 2^112
        pools[id].held -= uint128(amount);
        totalHeld -= amount;
    }

    function _credit(uint256 id, address m, uint256 amount) private {
        paid[id][m] = amount;
        // forge-lint: disable-next-line(unsafe-typecast) -- amount <= price (uint96) * seats (uint16) < 2^112
        pools[id].held += uint128(amount);
        totalHeld += amount;
    }

    /// @dev min(len, from + count) without overflow for any from/count.
    function _end(uint256 len, uint256 from, uint256 count) private pure returns (uint256) {
        if (from >= len) return from;
        return count >= len - from ? len : from + count;
    }

    function _path() private view returns (address[] memory path) {
        path = new address[](2);
        (path[0], path[1]) = (wqie, address(qusdc));
    }
}
