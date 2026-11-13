// Generated from the Foundry build by script/export-abi.sh (forge inspect Patungan abi). Do not edit.
export const patunganAbi = [
  {
    "type": "constructor",
    "inputs": [
      {
        "name": "qusdc_",
        "type": "address",
        "internalType": "contract IERC20"
      },
      {
        "name": "router_",
        "type": "address",
        "internalType": "contract IQieDexRouter"
      },
      {
        "name": "zone_",
        "type": "address",
        "internalType": "contract IQieZone"
      },
      {
        "name": "oracle_",
        "type": "address",
        "internalType": "contract IAggregatorV3"
      },
      {
        "name": "maxDevBps_",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "maxOracleAge_",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "receive",
    "stateMutability": "payable"
  },
  {
    "type": "function",
    "name": "MAX_DEV_BPS_CAP",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "MAX_DURATION",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "MAX_NAME_BYTES",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "MAX_SEATS",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint16",
        "internalType": "uint16"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "MAX_TITLE_BYTES",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "MIN_DURATION",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "MIN_SEATS",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint16",
        "internalType": "uint16"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "cancel",
    "inputs": [
      {
        "name": "id",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "claimRefund",
    "inputs": [
      {
        "name": "id",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "createPool",
    "inputs": [
      {
        "name": "payee",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "price",
        "type": "uint96",
        "internalType": "uint96"
      },
      {
        "name": "seats",
        "type": "uint16",
        "internalType": "uint16"
      },
      {
        "name": "deadline",
        "type": "uint40",
        "internalType": "uint40"
      },
      {
        "name": "title",
        "type": "string",
        "internalType": "string"
      }
    ],
    "outputs": [
      {
        "name": "id",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "createPoolByName",
    "inputs": [
      {
        "name": "name",
        "type": "string",
        "internalType": "string"
      },
      {
        "name": "expectedPayee",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "price",
        "type": "uint96",
        "internalType": "uint96"
      },
      {
        "name": "seats",
        "type": "uint16",
        "internalType": "uint16"
      },
      {
        "name": "deadline",
        "type": "uint40",
        "internalType": "uint40"
      },
      {
        "name": "title",
        "type": "string",
        "internalType": "string"
      }
    ],
    "outputs": [
      {
        "name": "id",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "getMembers",
    "inputs": [
      {
        "name": "id",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "from",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "count",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "addrs",
        "type": "address[]",
        "internalType": "address[]"
      },
      {
        "name": "seats",
        "type": "uint16[]",
        "internalType": "uint16[]"
      },
      {
        "name": "owed",
        "type": "uint256[]",
        "internalType": "uint256[]"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "getPool",
    "inputs": [
      {
        "name": "id",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "pool",
        "type": "tuple",
        "internalType": "struct Patungan.Pool",
        "components": [
          {
            "name": "organizer",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "payee",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "price",
            "type": "uint96",
            "internalType": "uint96"
          },
          {
            "name": "deadline",
            "type": "uint40",
            "internalType": "uint40"
          },
          {
            "name": "seats",
            "type": "uint16",
            "internalType": "uint16"
          },
          {
            "name": "filled",
            "type": "uint16",
            "internalType": "uint16"
          },
          {
            "name": "status",
            "type": "uint8",
            "internalType": "enum Patungan.Status"
          },
          {
            "name": "held",
            "type": "uint128",
            "internalType": "uint128"
          }
        ]
      },
      {
        "name": "title",
        "type": "string",
        "internalType": "string"
      },
      {
        "name": "payeeName",
        "type": "string",
        "internalType": "string"
      },
      {
        "name": "memberCount",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "refunded",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "refundable",
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "isRefundable",
    "inputs": [
      {
        "name": "id",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "isSolvent",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "join",
    "inputs": [
      {
        "name": "id",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "n",
        "type": "uint16",
        "internalType": "uint16"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "joinWithQIE",
    "inputs": [
      {
        "name": "id",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "n",
        "type": "uint16",
        "internalType": "uint16"
      },
      {
        "name": "expiry",
        "type": "uint40",
        "internalType": "uint40"
      }
    ],
    "outputs": [],
    "stateMutability": "payable"
  },
  {
    "type": "function",
    "name": "maxDevBps",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "maxOracleAge",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "nextId",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "oracle",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "contract IAggregatorV3"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "oracleDecimals",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint8",
        "internalType": "uint8"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "paid",
    "inputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "pools",
    "inputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "organizer",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "payee",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "price",
        "type": "uint96",
        "internalType": "uint96"
      },
      {
        "name": "deadline",
        "type": "uint40",
        "internalType": "uint40"
      },
      {
        "name": "seats",
        "type": "uint16",
        "internalType": "uint16"
      },
      {
        "name": "filled",
        "type": "uint16",
        "internalType": "uint16"
      },
      {
        "name": "status",
        "type": "uint8",
        "internalType": "enum Patungan.Status"
      },
      {
        "name": "held",
        "type": "uint128",
        "internalType": "uint128"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "quoteQIE",
    "inputs": [
      {
        "name": "id",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "n",
        "type": "uint16",
        "internalType": "uint16"
      }
    ],
    "outputs": [
      {
        "name": "qieIn",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "oracleFairQie",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "maxAllowedQie",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "qusdc",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "contract IERC20"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "qusdcDecimals",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint8",
        "internalType": "uint8"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "refundAll",
    "inputs": [
      {
        "name": "id",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "from",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "count",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "refundedCount",
    "inputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "router",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "contract IQieDexRouter"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "seatsOf",
    "inputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "uint16",
        "internalType": "uint16"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "totalHeld",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "wqie",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "address"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "zone",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "contract IQieZone"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "event",
    "name": "Joined",
    "inputs": [
      {
        "name": "id",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "member",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "n",
        "type": "uint16",
        "indexed": false,
        "internalType": "uint16"
      },
      {
        "name": "amount",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "paidWithQIE",
        "type": "bool",
        "indexed": false,
        "internalType": "bool"
      },
      {
        "name": "qieSpent",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "oraclePrice",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "PoolCancelled",
    "inputs": [
      {
        "name": "id",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "PoolCreated",
    "inputs": [
      {
        "name": "id",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "organizer",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "payee",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "payeeName",
        "type": "string",
        "indexed": false,
        "internalType": "string"
      },
      {
        "name": "price",
        "type": "uint96",
        "indexed": false,
        "internalType": "uint96"
      },
      {
        "name": "seats",
        "type": "uint16",
        "indexed": false,
        "internalType": "uint16"
      },
      {
        "name": "deadline",
        "type": "uint40",
        "indexed": false,
        "internalType": "uint40"
      },
      {
        "name": "title",
        "type": "string",
        "indexed": false,
        "internalType": "string"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "PoolPaid",
    "inputs": [
      {
        "name": "id",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "payee",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "total",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "RefundFailed",
    "inputs": [
      {
        "name": "id",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "member",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "amount",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "Refunded",
    "inputs": [
      {
        "name": "id",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "member",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "amount",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "error",
    "name": "BadParams",
    "inputs": []
  },
  {
    "type": "error",
    "name": "ForwardFailed",
    "inputs": []
  },
  {
    "type": "error",
    "name": "Insolvent",
    "inputs": []
  },
  {
    "type": "error",
    "name": "NotOrganizer",
    "inputs": []
  },
  {
    "type": "error",
    "name": "NotRefundable",
    "inputs": []
  },
  {
    "type": "error",
    "name": "NothingToRefund",
    "inputs": []
  },
  {
    "type": "error",
    "name": "OnlyRouter",
    "inputs": []
  },
  {
    "type": "error",
    "name": "OracleBadPrice",
    "inputs": []
  },
  {
    "type": "error",
    "name": "OracleStale",
    "inputs": [
      {
        "name": "updatedAt",
        "type": "uint256",
        "internalType": "uint256"
      }
    ]
  },
  {
    "type": "error",
    "name": "PayeeChanged",
    "inputs": [
      {
        "name": "resolved",
        "type": "address",
        "internalType": "address"
      }
    ]
  },
  {
    "type": "error",
    "name": "PayeeInvalid",
    "inputs": []
  },
  {
    "type": "error",
    "name": "PayeeNotFound",
    "inputs": []
  },
  {
    "type": "error",
    "name": "PoolNotOpen",
    "inputs": []
  },
  {
    "type": "error",
    "name": "PriceDeviation",
    "inputs": [
      {
        "name": "fairQie",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "qieIn",
        "type": "uint256",
        "internalType": "uint256"
      }
    ]
  },
  {
    "type": "error",
    "name": "QuoteExpired",
    "inputs": []
  },
  {
    "type": "error",
    "name": "ReentrancyGuardReentrantCall",
    "inputs": []
  },
  {
    "type": "error",
    "name": "SafeERC20FailedOperation",
    "inputs": [
      {
        "name": "token",
        "type": "address",
        "internalType": "address"
      }
    ]
  },
  {
    "type": "error",
    "name": "SwapShort",
    "inputs": []
  },
  {
    "type": "error",
    "name": "TooManySeats",
    "inputs": []
  },
  {
    "type": "error",
    "name": "TransferShort",
    "inputs": []
  },
  {
    "type": "error",
    "name": "ValueTooLow",
    "inputs": [
      {
        "name": "needed",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "sent",
        "type": "uint256",
        "internalType": "uint256"
      }
    ]
  }
] as const
