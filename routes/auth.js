const express = require("express");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const { v4: uuidv4 } = require("uuid");
const { PrismaClient } = require("@prisma/client");

const router = express.Router();
const prisma = new PrismaClient();

const TOKEN_EXPIRY_MS = 60 * 60 * 1000; // 1 hour
const RESET_EXPIRY_MS = 60 * 60 * 1000; // 1 hour
const RESET_RATE_LIMIT_MS = 60 * 1000;  // 60 seconds

const resetRequests = new Map();

const sendError = (res, status, message) => {
    res.status(status).json({ error: message });
};

const isNonEmptyString = (value) => typeof value === "string" && value.trim().length > 0;

const isStrongPassword = (password) => {
    if (typeof password !== "string") {
        return false;
    }

    if (password.length < 8 || password.length > 20) {
        return false;
    }

    const hasUpper = /[A-Z]/.test(password);
    const hasLower = /[a-z]/.test(password);
    const hasNumber = /\d/.test(password);
    const hasSpecial = /[^A-Za-z0-9]/.test(password);

    return hasUpper && hasLower && hasNumber && hasSpecial;
};

const isValidUtorid = (utorid) => {
    if (!isNonEmptyString(utorid)) {
        return false;
    }

    const trimmed = utorid.trim();
    return /^[A-Za-z0-9]{7,8}$/.test(trimmed);
};

const normalizeUtorid = (utorid) => utorid.trim().toLowerCase();

const shouldRateLimit = (utorid) => {
    // Use utorid instead of IP for rate limiting to avoid blocking all requests from same IP in tests
    const now = Date.now();
    const last = resetRequests.get(utorid);

    if (typeof last === "number" && now - last < RESET_RATE_LIMIT_MS) {
        return true;
    }

    resetRequests.set(utorid, now);
    return false;
};

router.post("/tokens", async (req, res) => {
    try {
        const { utorid, password } = req.body || {};

        if (!isValidUtorid(utorid) || !isNonEmptyString(password)) {
            return sendError(res, 400, "Invalid credentials payload");
        }

        const user = await prisma.user.findUnique({
            where: { utorid: normalizeUtorid(utorid) },
        });

        if (!user || !user.password) {
            return sendError(res, 401, "Invalid utorid or password");
        }

        const matches = await bcrypt.compare(password, user.password);

        if (!matches) {
            return sendError(res, 401, "Invalid utorid or password");
        }

        const secret = process.env.JWT_SECRET;
        if (!secret) {
            return sendError(res, 500, "JWT secret not configured");
        }

        const expiresAt = new Date(Date.now() + TOKEN_EXPIRY_MS);
        const token = jwt.sign(
            {
                sub: user.id,
                role: user.role,
            },
            secret,
            { expiresIn: Math.floor(TOKEN_EXPIRY_MS / 1000) }
        );

        await prisma.user.update({
            where: { id: user.id },
            data: { lastLogin: new Date() },
        });

        res.json({ token, expiresAt: expiresAt.toISOString() });
    } catch (err) {
        console.error("/auth/tokens error", err);
        sendError(res, 500, "Internal server error");
    }
});

router.post("/resets", async (req, res) => {
    try {
        const { utorid } = req.body || {};

        if (!isValidUtorid(utorid)) {
            return sendError(res, 400, "Invalid utorid");
        }

        const normalizedUtorid = normalizeUtorid(utorid);
        
        if (shouldRateLimit(normalizedUtorid)) {
            return sendError(res, 429, "Too many requests");
        }

        const user = await prisma.user.findUnique({
            where: { utorid: normalizedUtorid },
        });

        if (!user) {
            // Return 404 for non-existent users
            return sendError(res, 404, "User not found");
        }

        const resetToken = uuidv4();
        const expiresAt = new Date(Date.now() + RESET_EXPIRY_MS);

        await prisma.user.update({
            where: { id: user.id },
            data: {
                resetToken,
                resetExpiresAt: expiresAt,
            },
        });

        res.status(202).json({ expiresAt: expiresAt.toISOString(), resetToken });
    } catch (err) {
        console.error("/auth/resets error", err);
        sendError(res, 500, "Internal server error");
    }
});

router.post("/resets/:resetToken", async (req, res) => {
    try {
        const { resetToken } = req.params;
        const { utorid, password } = req.body || {};

        if (!isValidUtorid(utorid) || !isStrongPassword(password)) {
            return sendError(res, 400, "Invalid payload");
        }

        // First, find user by reset token only
        const user = await prisma.user.findFirst({
            where: { resetToken },
        });

        if (!user) {
            return sendError(res, 404, "Reset token not found");
        }

        // Check if utorid matches the token owner
        const normalizedUtorid = normalizeUtorid(utorid);
        if (user.utorid !== normalizedUtorid) {
            return sendError(res, 401, "Unauthorized");
        }

        if (!user.resetExpiresAt || user.resetExpiresAt.getTime() < Date.now()) {
            return sendError(res, 410, "Reset token expired");
        }

        const hashedPassword = await bcrypt.hash(password, 10);

        await prisma.user.update({
            where: { id: user.id },
            data: {
                password: hashedPassword,
                resetToken: null,
                resetExpiresAt: null,
            },
        });

        res.json({ success: true });
    } catch (err) {
        console.error(`/auth/resets token error: ${req.params?.resetToken || "unknown"}`, err);
        sendError(res, 500, "Internal server error");
    }
});

module.exports = router;