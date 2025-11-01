#!/usr/bin/env node
'use strict';
require('dotenv').config();

const Port = () => {
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
};

const express = require("express");
const { expressjwt: jwt } = require("express-jwt");
const app = express();

app.use(express.json());

// JWT middleware - decodes token and attaches to req.auth
app.use(
    jwt({
        secret: process.env.JWT_SECRET || "test-secret-key",
        algorithms: ["HS256"],
        credentialsRequired: false,
    })
);

const authRoutes = require("./routes/auth");
const eventRoutes = require("./routes/events");
const promotionRoutes = require("./routes/promotions");
const transactionRoutes = require("./routes/transactions");
const userRoutes = require("./routes/users");

app.use("/auth", authRoutes);
app.use("/events", eventRoutes);
app.use("/promotions", promotionRoutes);
app.use("/transactions", transactionRoutes);
app.use("/users", userRoutes);

app.use((err, req, res, next) => {
    if (err.name === "UnauthorizedError") {
        return res.status(401).json({ error: "Unauthorized: invalid or missing token" });
    }
    return next(err);
});

if (require.main === module) {
    const port = Port();
    const server = app.listen(port, () => {
        console.log(`Server running on port ${port}`);
    });

    server.on("error", (err) => {
        console.error(`cannot start server: ${err.message}`);
        process.exit(1);
    });
}

module.exports = app;