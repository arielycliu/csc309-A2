const { before, after, beforeEach, test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { PrismaClient } = require('@prisma/client');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-key';

const prisma = new PrismaClient();
let server;
let baseUrl;

const TEST_USERS = {
    regular: {
        utorid: 'regular1',
        name: 'Regular User',
        email: 'regular@mail.utoronto.ca',
        role: 'regular',
        verified: true,
        password: 'Password123!',
    },
    cashier: {
        utorid: 'cashier1',
        name: 'Casey Cashier',
        email: 'cashier@mail.utoronto.ca',
        role: 'cashier',
        verified: true,
        password: 'Password123!',
        suspicious: false,
    },
    suspiciousCashier: {
        utorid: 'badcash1',
        name: 'Bad Cashier',
        email: 'badcashier@mail.utoronto.ca',
        role: 'cashier',
        verified: true,
        password: 'Password123!',
        suspicious: true,
    },
    manager: {
        utorid: 'manager1',
        name: 'Manager User',
        email: 'manager@mail.utoronto.ca',
        role: 'manager',
        verified: true,
        password: 'Password123!',
    },
};

let userIds = {};
let tokens = {};

const generateToken = (userId, role) => {
    return jwt.sign(
        { sub: userId, role },
        process.env.JWT_SECRET,
        { expiresIn: '1h' }
    );
};

before(async () => {
    await prisma.transactionPromotion.deleteMany();
    await prisma.transaction.deleteMany();
    await prisma.promotion.deleteMany();
    await prisma.user.deleteMany();

    for (const [key, userData] of Object.entries(TEST_USERS)) {
        const hashedPassword = await bcrypt.hash(userData.password, 10);
        const user = await prisma.user.create({
            data: {
                utorid: userData.utorid,
                name: userData.name,
                email: userData.email,
                role: userData.role,
                verified: userData.verified,
                password: hashedPassword,
                suspicious: userData.suspicious || false,
                points: 100,
            },
        });
        userIds[key] = user.id;
        tokens[key] = generateToken(user.id, user.role);
    }

    server = http.createServer(require('../index')).listen(0);
    const { port } = server.address();
    baseUrl = `http://127.0.0.1:${port}`;
});

beforeEach(async () => {
    await prisma.transactionPromotion.deleteMany();
    await prisma.transaction.deleteMany();
    await prisma.promotion.deleteMany();

    await prisma.user.update({
        where: { id: userIds.regular },
        data: { points: 100 },
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

// POST /transactions - Purchase Tests
test('POST /transactions rejects purchase without authentication', async () => {
    const response = await fetch(`${baseUrl}/transactions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
            type: 'purchase',
            utorid: TEST_USERS.regular.utorid,
            spent: 10.00,
        }),
    });

    assert.strictEqual(response.status, 401);
});

test('POST /transactions rejects purchase from regular user', async () => {
    const response = await fetch(`${baseUrl}/transactions`, {
        method: 'POST',
        headers: {
            'content-type': 'application/json',
            'authorization': `Bearer ${tokens.regular}`,
        },
        body: JSON.stringify({
            type: 'purchase',
            utorid: TEST_USERS.regular.utorid,
            spent: 10.00,
        }),
    });

    assert.strictEqual(response.status, 403);
    const body = await response.json();
    assert.ok(body.error);
});

test('POST /transactions creates purchase and awards points', async () => {
    const response = await fetch(`${baseUrl}/transactions`, {
        method: 'POST',
        headers: {
            'content-type': 'application/json',
            'authorization': `Bearer ${tokens.cashier}`,
        },
        body: JSON.stringify({
            type: 'purchase',
            utorid: TEST_USERS.regular.utorid,
            spent: 10.00,
            remark: 'Test purchase',
        }),
    });

    assert.strictEqual(response.status, 201);
    const body = await response.json();
    assert.ok(body.id);
    assert.strictEqual(body.type, 'purchase');
    assert.strictEqual(body.utorid, TEST_USERS.regular.utorid);
    assert.strictEqual(body.spent, 10.00);
    assert.strictEqual(body.earned, 40); // 10.00 / 0.25 = 40 points
    assert.strictEqual(body.createdBy, TEST_USERS.cashier.utorid);
    assert.strictEqual(body.remark, 'Test purchase');

    const user = await prisma.user.findUnique({
        where: { utorid: TEST_USERS.regular.utorid },
    });
    assert.strictEqual(user.points, 140); // 100 + 40
});

test('POST /transactions suspicious cashier creates suspicious purchase', async () => {
    const response = await fetch(`${baseUrl}/transactions`, {
        method: 'POST',
        headers: {
            'content-type': 'application/json',
            'authorization': `Bearer ${tokens.suspiciousCashier}`,
        },
        body: JSON.stringify({
            type: 'purchase',
            utorid: TEST_USERS.regular.utorid,
            spent: 10.00,
        }),
    });

    assert.strictEqual(response.status, 201);
    const body = await response.json();
    assert.ok(body.id);

    const transaction = await prisma.transaction.findUnique({
        where: { id: body.id },
    });
    assert.strictEqual(transaction.suspicious, true);

    const user = await prisma.user.findUnique({
        where: { utorid: TEST_USERS.regular.utorid },
    });
    assert.strictEqual(user.points, 100); // No points awarded for suspicious transaction
});

test('POST /transactions purchase validates spent amount', async () => {
    const response = await fetch(`${baseUrl}/transactions`, {
        method: 'POST',
        headers: {
            'content-type': 'application/json',
            'authorization': `Bearer ${tokens.cashier}`,
        },
        body: JSON.stringify({
            type: 'purchase',
            utorid: TEST_USERS.regular.utorid,
            spent: -5.00,
        }),
    });

    assert.strictEqual(response.status, 400);
    const body = await response.json();
    assert.ok(body.error);
});

test('POST /transactions purchase with automatic promotion', async () => {
    const promotion = await prisma.promotion.create({
        data: {
            name: 'Double Points',
            description: 'Get double points',
            type: 'automatic',
            startTime: new Date(Date.now() - 1000 * 60 * 60),
            endTime: new Date(Date.now() + 1000 * 60 * 60),
            rate: 1.0, // 1 extra point per dollar
        },
    });

    const response = await fetch(`${baseUrl}/transactions`, {
        method: 'POST',
        headers: {
            'content-type': 'application/json',
            'authorization': `Bearer ${tokens.cashier}`,
        },
        body: JSON.stringify({
            type: 'purchase',
            utorid: TEST_USERS.regular.utorid,
            spent: 10.00,
            promotionIds: [promotion.id],
        }),
    });

    assert.strictEqual(response.status, 201);
    const body = await response.json();
    // rate bonus is computed as: Math.round(spentCents * rate) = Math.round(1000 * 1.0) = 1000
    // Base 40 + 1000 bonus = 1040 points
    assert.strictEqual(body.earned, 1040);
    assert.deepStrictEqual(body.promotionIds, [promotion.id]);

    const user = await prisma.user.findUnique({
        where: { utorid: TEST_USERS.regular.utorid },
    });
    assert.strictEqual(user.points, 1140); // 100 + 1040
});

test('POST /transactions purchase with onetime promotion', async () => {
    const promotion = await prisma.promotion.create({
        data: {
            name: 'Bonus Points',
            description: 'Get 50 bonus points',
            type: 'onetime',
            startTime: new Date(Date.now() - 1000 * 60 * 60),
            endTime: new Date(Date.now() + 1000 * 60 * 60),
            points: 50,
        },
    });

    const response = await fetch(`${baseUrl}/transactions`, {
        method: 'POST',
        headers: {
            'content-type': 'application/json',
            'authorization': `Bearer ${tokens.cashier}`,
        },
        body: JSON.stringify({
            type: 'purchase',
            utorid: TEST_USERS.regular.utorid,
            spent: 10.00,
            promotionIds: [promotion.id],
        }),
    });

    assert.strictEqual(response.status, 201);
    const body = await response.json();
    assert.strictEqual(body.earned, 90); // Base 40 + 50 bonus

    // Try to use the same one-time promotion again
    const response2 = await fetch(`${baseUrl}/transactions`, {
        method: 'POST',
        headers: {
            'content-type': 'application/json',
            'authorization': `Bearer ${tokens.cashier}`,
        },
        body: JSON.stringify({
            type: 'purchase',
            utorid: TEST_USERS.regular.utorid,
            spent: 10.00,
            promotionIds: [promotion.id],
        }),
    });

    assert.strictEqual(response2.status, 400);
    const body2 = await response2.json();
    assert.ok(body2.error.includes('already used'));
});

test('POST /transactions purchase rejects expired promotion', async () => {
    const promotion = await prisma.promotion.create({
        data: {
            name: 'Expired Promo',
            description: 'This promotion has ended',
            type: 'automatic',
            startTime: new Date(Date.now() - 1000 * 60 * 120),
            endTime: new Date(Date.now() - 1000 * 60 * 60),
            points: 50,
        },
    });

    const response = await fetch(`${baseUrl}/transactions`, {
        method: 'POST',
        headers: {
            'content-type': 'application/json',
            'authorization': `Bearer ${tokens.cashier}`,
        },
        body: JSON.stringify({
            type: 'purchase',
            utorid: TEST_USERS.regular.utorid,
            spent: 10.00,
            promotionIds: [promotion.id],
        }),
    });

    assert.strictEqual(response.status, 400);
    const body = await response.json();
    assert.ok(body.error.includes('not active'));
});

// POST /transactions - Adjustment Tests
test('POST /transactions rejects adjustment from cashier', async () => {
    const response = await fetch(`${baseUrl}/transactions`, {
        method: 'POST',
        headers: {
            'content-type': 'application/json',
            'authorization': `Bearer ${tokens.cashier}`,
        },
        body: JSON.stringify({
            type: 'adjustment',
            utorid: TEST_USERS.regular.utorid,
            amount: 50,
            relatedId: 1,
        }),
    });

    assert.strictEqual(response.status, 403);
});

test('POST /transactions creates adjustment transaction', async () => {
    const purchase = await prisma.transaction.create({
        data: {
            type: 'purchase',
            spent: 10.00,
            amount: 40,
            userId: userIds.regular,
            createdById: userIds.cashier,
        },
    });

    const response = await fetch(`${baseUrl}/transactions`, {
        method: 'POST',
        headers: {
            'content-type': 'application/json',
            'authorization': `Bearer ${tokens.manager}`,
        },
        body: JSON.stringify({
            type: 'adjustment',
            utorid: TEST_USERS.regular.utorid,
            amount: -10,
            relatedId: purchase.id,
            remark: 'Price correction',
        }),
    });

    assert.strictEqual(response.status, 201);
    const body = await response.json();
    assert.ok(body.id);
    assert.strictEqual(body.type, 'adjustment');
    assert.strictEqual(body.amount, -10);
    assert.strictEqual(body.relatedId, purchase.id);
    assert.strictEqual(body.createdBy, TEST_USERS.manager.utorid);

    const user = await prisma.user.findUnique({
        where: { utorid: TEST_USERS.regular.utorid },
    });
    assert.strictEqual(user.points, 90); // 100 - 10
});

test('POST /transactions adjustment validates relatedId belongs to user', async () => {
    const otherUserPurchase = await prisma.transaction.create({
        data: {
            type: 'purchase',
            spent: 10.00,
            amount: 40,
            userId: userIds.cashier,
            createdById: userIds.cashier,
        },
    });

    const response = await fetch(`${baseUrl}/transactions`, {
        method: 'POST',
        headers: {
            'content-type': 'application/json',
            'authorization': `Bearer ${tokens.manager}`,
        },
        body: JSON.stringify({
            type: 'adjustment',
            utorid: TEST_USERS.regular.utorid,
            amount: -10,
            relatedId: otherUserPurchase.id,
        }),
    });

    assert.strictEqual(response.status, 400);
    const body = await response.json();
    assert.ok(body.error.includes('does not match'));
});

// GET /transactions Tests
test('GET /transactions requires authentication', async () => {
    const response = await fetch(`${baseUrl}/transactions`);

    assert.strictEqual(response.status, 401);
});

test('GET /transactions rejects non-manager', async () => {
    const response = await fetch(`${baseUrl}/transactions`, {
        headers: { 'authorization': `Bearer ${tokens.cashier}` },
    });

    assert.strictEqual(response.status, 403);
});

test('GET /transactions returns paginated results', async () => {
    await prisma.transaction.create({
        data: {
            type: 'purchase',
            spent: 10.00,
            amount: 40,
            userId: userIds.regular,
            createdById: userIds.cashier,
        },
    });

    await prisma.transaction.create({
        data: {
            type: 'purchase',
            spent: 5.00,
            amount: 20,
            userId: userIds.regular,
            createdById: userIds.cashier,
        },
    });

    const response = await fetch(`${baseUrl}/transactions?page=1&limit=10`, {
        headers: { 'authorization': `Bearer ${tokens.manager}` },
    });

    assert.strictEqual(response.status, 200);
    const body = await response.json();
    assert.ok(body.count >= 2);
    assert.ok(Array.isArray(body.results));
    assert.ok(body.results.length >= 2);
});

test('GET /transactions filters by type', async () => {
    const purchase = await prisma.transaction.create({
        data: {
            type: 'purchase',
            spent: 10.00,
            amount: 40,
            userId: userIds.regular,
            createdById: userIds.cashier,
        },
    });

    const adjustment = await prisma.transaction.create({
        data: {
            type: 'adjustment',
            amount: -10,
            userId: userIds.regular,
            createdById: userIds.manager,
            relatedTransactionId: purchase.id,
        },
    });

    const response = await fetch(`${baseUrl}/transactions?type=adjustment`, {
        headers: { 'authorization': `Bearer ${tokens.manager}` },
    });

    assert.strictEqual(response.status, 200);
    const body = await response.json();
    assert.ok(body.results.every(tx => tx.type === 'adjustment'));
});

test('GET /transactions filters by suspicious flag', async () => {
    await prisma.transaction.create({
        data: {
            type: 'purchase',
            spent: 10.00,
            amount: 40,
            suspicious: true,
            userId: userIds.regular,
            createdById: userIds.suspiciousCashier,
        },
    });

    const response = await fetch(`${baseUrl}/transactions?suspicious=true`, {
        headers: { 'authorization': `Bearer ${tokens.manager}` },
    });

    assert.strictEqual(response.status, 200);
    const body = await response.json();
    assert.ok(body.results.every(tx => tx.suspicious === true));
});

// GET /transactions/:transactionId Tests
test('GET /transactions/:id returns transaction details', async () => {
    const transaction = await prisma.transaction.create({
        data: {
            type: 'purchase',
            spent: 10.00,
            amount: 40,
            remark: 'Test purchase',
            userId: userIds.regular,
            createdById: userIds.cashier,
        },
    });

    const response = await fetch(`${baseUrl}/transactions/${transaction.id}`, {
        headers: { 'authorization': `Bearer ${tokens.manager}` },
    });

    assert.strictEqual(response.status, 200);
    const body = await response.json();
    assert.strictEqual(body.id, transaction.id);
    assert.strictEqual(body.type, 'purchase');
    assert.strictEqual(body.spent, 10.00);
    assert.strictEqual(body.earned, 40);
    assert.strictEqual(body.remark, 'Test purchase');
});

test('GET /transactions/:id returns 404 for nonexistent transaction', async () => {
    const response = await fetch(`${baseUrl}/transactions/999999`, {
        headers: { 'authorization': `Bearer ${tokens.manager}` },
    });

    assert.strictEqual(response.status, 404);
});

// PATCH /transactions/:transactionId/suspicious Tests
test('PATCH /transactions/:id/suspicious toggles suspicious flag', async () => {
    const transaction = await prisma.transaction.create({
        data: {
            type: 'purchase',
            spent: 10.00,
            amount: 40,
            suspicious: false,
            userId: userIds.regular,
            createdById: userIds.cashier,
        },
    });

    await prisma.user.update({
        where: { id: userIds.regular },
        data: { points: 140 }, // 100 + 40 from purchase
    });

    const response = await fetch(`${baseUrl}/transactions/${transaction.id}/suspicious`, {
        method: 'PATCH',
        headers: {
            'content-type': 'application/json',
            'authorization': `Bearer ${tokens.manager}`,
        },
        body: JSON.stringify({ suspicious: true }),
    });

    assert.strictEqual(response.status, 200);
    const body = await response.json();
    assert.strictEqual(body.suspicious, true);

    const user = await prisma.user.findUnique({
        where: { id: userIds.regular },
    });
    assert.strictEqual(user.points, 100); // Points deducted when marked suspicious
});

test('PATCH /transactions/:id/suspicious unsuspicious restores points', async () => {
    const transaction = await prisma.transaction.create({
        data: {
            type: 'purchase',
            spent: 10.00,
            amount: 40,
            suspicious: true,
            userId: userIds.regular,
            createdById: userIds.suspiciousCashier,
        },
    });

    const response = await fetch(`${baseUrl}/transactions/${transaction.id}/suspicious`, {
        method: 'PATCH',
        headers: {
            'content-type': 'application/json',
            'authorization': `Bearer ${tokens.manager}`,
        },
        body: JSON.stringify({ suspicious: false }),
    });

    assert.strictEqual(response.status, 200);
    const body = await response.json();
    assert.strictEqual(body.suspicious, false);

    const user = await prisma.user.findUnique({
        where: { id: userIds.regular },
    });
    assert.strictEqual(user.points, 140); // Points restored when unsuspicious
});

test('PATCH /transactions/:id/suspicious rejects non-manager', async () => {
    const transaction = await prisma.transaction.create({
        data: {
            type: 'purchase',
            spent: 10.00,
            amount: 40,
            userId: userIds.regular,
            createdById: userIds.cashier,
        },
    });

    const response = await fetch(`${baseUrl}/transactions/${transaction.id}/suspicious`, {
        method: 'PATCH',
        headers: {
            'content-type': 'application/json',
            'authorization': `Bearer ${tokens.cashier}`,
        },
        body: JSON.stringify({ suspicious: true }),
    });

    assert.strictEqual(response.status, 403);
});
