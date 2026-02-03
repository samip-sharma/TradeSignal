// lib/alpaca.js

import Alpaca from "@alpacahq/alpaca-trade-api";

const alpaca = new Alpaca({
  paper: true,
  keyId: process.env.ALPACA_API_KEY,
  secretKey: process.env.ALPACA_API_SECRET,
});

export default alpaca;
