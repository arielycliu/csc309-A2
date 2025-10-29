#!/usr/bin/env node
'use strict';

const port = (() => {
    const args = process.argv;

    if (args.length !== 3) {
        console.error("usage: node index.js port");
        process.exit(1);
    }

    const num = parseInt(args[2], 10);
    if (isNaN(num)) {
        console.error("error: argument must be an integer.");
        process.exit(1);
    }

    return num;
})();

const express = require("express");
const app = express();

app.use(express.json());

// ADD YOUR WORK HERE
const authRoutes = require("./routes/auth")
const eventRoutes = require("./routes/events")
const promotionRoutes = require("./routes/promotions")
const transactionRoutes = require("./routes/transactions")
const userRoutes = require("./routes/users")
app.use("/auth", authRoutes)
app.use("/events", eventRoutes)
app.use("/promotions", promotionRoutes)
app.use("/transactions", transactionRoutes)
app.use("/users", userRoutes)

// could not figure out a clean way to cover 405 and 404 cases
// might need to check them manually each time

const server = app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});

server.on('error', (err) => {
    console.error(`cannot start server: ${err.message}`);
    process.exit(1);
});