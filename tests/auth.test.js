const { before, after, beforeEach, test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const bcrypt = require('bcrypt');
const { PrismaClient } = require('@prisma/client');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-key';

const prisma = new PrismaClient();
let server;
let baseUrl;
let baselineHash;

const TEST_USER = {
    utorid: 'cashier1',
    name: 'Casey Cashier',
    email: 'casey.cashier@mail.utoronto.ca',
    role: 'regular',
    verified: true,
};

const TEST_PASSWORD = 'Password123!';
const NEW_PASSWORD = 'NewPassword123!';

before(async () => {
    baselineHash = await bcrypt.hash(TEST_PASSWORD, 10);

    await prisma.transactionPromotion.deleteMany();
    await prisma.transaction.deleteMany();
    await prisma.user.deleteMany();

    await prisma.user.create({
        data: {
            utorid: TEST_USER.utorid,
            name: TEST_USER.name,
            email: TEST_USER.email,
            role: TEST_USER.role,
            verified: TEST_USER.verified,
            password: baselineHash,
        },
    });

    server = http.createServer(require('../index')).listen(0);
    const { port } = server.address();
    baseUrl = `http://127.0.0.1:${port}`;
});

beforeEach(async () => {
    await prisma.user.update({
        where: { utorid: TEST_USER.utorid },
        data: {
            password: baselineHash,
            lastLogin: null,
            resetToken: null,
            resetExpiresAt: null,
        },
    });
});

after(async () => {
    if (server) {
        await new Promise((resolve, reject) => {
            server.close((err) => (err ? reject(err) : resolve()));
        });
    }
    await prisma.$disconnect();
});

test('POST /auth/tokens rejects invalid payload', async () => {
    const response = await fetch(`${baseUrl}/auth/tokens`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ utorid: 'short' }),
    });

    assert.strictEqual(response.status, 400);
    const body = await response.json();
    assert.ok(body.error);
});

test('POST /auth/tokens authenticates valid credentials and updates lastLogin', async () => {
    const response = await fetch(`${baseUrl}/auth/tokens`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ utorid: TEST_USER.utorid, password: TEST_PASSWORD }),
    });

    assert.strictEqual(response.status, 200);
    const body = await response.json();
    assert.ok(body.token);
    assert.ok(body.expiresAt);

    const updatedUser = await prisma.user.findUnique({
        where: { utorid: TEST_USER.utorid },
        select: { lastLogin: true },
    });

    assert.ok(updatedUser.lastLogin instanceof Date);
});

test('password reset flow issues token and accepts new password', async () => {
    const resetResponse = await fetch(`${baseUrl}/auth/resets`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ utorid: TEST_USER.utorid }),
    });

    assert.strictEqual(resetResponse.status, 202);
    const resetBody = await resetResponse.json();
    assert.ok(resetBody.resetToken);
    assert.ok(resetBody.expiresAt);

    const stored = await prisma.user.findUnique({
        where: { utorid: TEST_USER.utorid },
        select: { resetToken: true, resetExpiresAt: true },
    });

    assert.strictEqual(stored.resetToken, resetBody.resetToken);
    assert.ok(stored.resetExpiresAt instanceof Date);

    const consumeResponse = await fetch(`${baseUrl}/auth/resets/${resetBody.resetToken}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ utorid: TEST_USER.utorid, password: NEW_PASSWORD }),
    });

    assert.strictEqual(consumeResponse.status, 200);
    const consumeBody = await consumeResponse.json();
    assert.deepStrictEqual(consumeBody, { success: true });

    const loginResponse = await fetch(`${baseUrl}/auth/tokens`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ utorid: TEST_USER.utorid, password: NEW_PASSWORD }),
    });

    assert.strictEqual(loginResponse.status, 200);
    const loginBody = await loginResponse.json();
    assert.ok(loginBody.token);
});
