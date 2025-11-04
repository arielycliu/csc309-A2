const { CLEARANCE, requireClearance } = require('./auth_middleware');
const { validateString, validateEnum, validateNumber, validateInputFields } = require('./utils/validators');
const { PrismaClient, TransactionType } = require('@prisma/client');

const prisma = new PrismaClient();
const express = require("express");
const router = express.Router();

const validators = {
    userId(userId, required = true) {
        return validateNumber(userId, 'userId', { required })
    },

    type(type, allowedValues, required = true) {
        return validateEnum(type, 'type', allowedValues, { required });
    },

    amount(amount, required = true) {
        return validateNumber(amount, 'amount', { required, requireInteger: true, minValue: 0, minInclusive: true })
    },

    remark(remark, required = false) {
        return validateString(remark, 'remark', { required })
    },

    relatedId(relatedId, type, allowedValues, required = false) { // must be used with type
        if (relatedId !== undefined && validateEnum(type, 'type', allowedValues, { required: true })) {
            return 'relatedId must be used with type. ' + validateEnum(type, 'type', ['redemption'], { required: true })
        }
        return validateNumber(relatedId, 'relatedId', { required })
    },

    promotionId(promotionId, required = false) {
        return validateNumber(promotionId, 'promotionId', { required })
    },

    operator(operator, allowedValues, required = false) {
        return validateEnum(operator, 'operator', allowedValues, { required: false });
    },

    amountWithOperator(amount, operator, allowedValues, required = false) { // must be used with operator
        if (amount !== undefined && validateEnum(operator, 'operator', allowedValues, { required: true }))
        return validateNumber(amount, 'amount', { required })
    },

    page(page, required = false) {
        return validateNumber(page, 'page', { required });
    },

    limit(limit, required = false) {
        return validateNumber(limit, 'limit', { required });
    },
};

// create a new redemption transaction -> regular
router.post('/me/transactions', requireClearance(CLEARANCE.REGULAR), async (req, res) => {
    const { type, amount, remark } = req.body;
    let validations = [
        () => validators.type(type, ['redemption'], true),
        () => validators.amount(amount, true),
        () => validators.remark(remark, false)
    ]
    if (validateInputFields(validations, res)) return;

    await prisma.$transaction(async (prisma) => {
        const pointAmount = parseInt(amount);
        const userId = parseInt(req.auth.sub);
        const user = await prisma.user.findUnique({
            where: { id: userId }
        });
        if (!user) {
            return res.status(500).json({ 'error': 'UserId of self not found' })
        }
        if (user.points < pointAmount) {
            return res.status(400).json({ 'error': `User has ${user.points} points, but tried to redeem ${pointAmount} points` })
        }
        if (user.verified === false) {
            return res.status(403).json({ 'error': 'User cannot redeem points, they need to be verified first' })
        }

        const transaction = await prisma.transaction.create({
            data: {
                type: TransactionType.redemption,
                amount: -(pointAmount),
                remark: remark ?? null,
                userId,
                createdById: userId
            }
        });

        const result = {
            id: transaction.id,
            utorid: user.utorid,
            type,
            processedBy: transaction.processedById,
            amount: pointAmount,
            remark: remark ?? "",
            createdBy: user.utorid
        }
        res.status(201).json(result);
    })
});

// Retrieve a list of transactions owned by the currently logged in user
router.get('/me/transactions', requireClearance(CLEARANCE.REGULAR), async (req, res) => {
    const {
        type,
        relatedId,
        promotionId,
        operator,
        amount,
        page,
        limit
    } = req.body;

    const transactionTypes = ['purchase', 'redemption', 'adjustment', 'event', 'transfer'];
    let validations = [
        () => validators.type(type, transactionTypes, false),
        () => validators.relatedId(relatedId, type, transactionTypes, false),
        () => validators.promotionId(promotionId, false),
        () => validators.operator(operator, ['gte', 'lte'], false),
        () => validators.amountWithOperator(amount, operator, ['gte', 'lte'], false),
        () => validators.page(page, false),
        () => validators.limit(limit, false)
    ]
    if (validateInputFields(validations, res)) return;

    const pageNumber = parseInt(page) || 1;
    const limitNumber = parseInt(limit) || 10;
    const skip = (pageNumber - 1) * limitNumber;
    const take = limitNumber;

    const userId = parseInt(req.auth.sub);
    const user = await prisma.user.findUnique({
        where: { id: userId }
    });
    if (!user) {
        return res.status(500).json({ 'error': 'UserId of self not found' })
    }

    filters = { userId: userId }
    if (type != null) {
        filters.type = { type }
    }
    if (relatedId != null && type != null) {
        filters.relatedTransactionId = { relatedId }
    }
    if (promotionId != null) {
        filters.promotions = { 
            some: {
                id: promotionId
            }
        }
    }
    if (amount != null && operator != null) {
        filters.amount = {
            [operator]: amount
        }
    }

    const transactions = await prisma.transaction.findMany({
        where: filters,
        select: { 
            id: true,
            type: true,
            spent: true,
            amount: true,
            promotions: { select: { promotionId: true }},
            remark: true
        }
    });
    const results = transactions.map(t => ({
        id: t.id,
        type: t.type,
        spent: t.spent,
        amount: t.amount,
        promotionIds: t.promotions.map(p => p.promotionId), // flatten
        remark: t.remark
    }));
    const count = await prisma.transaction.count({ where: filters });
    res.status(200).json({ count, results });
});

// Create a new transfer transaction between the current logged-in user and userId
router.post('/:userId/transactions', requireClearance(CLEARANCE.REGULAR), async (req, res) => {
    const userId = req.params["userId"];
    const { type, amount, remark } = req.body;
    let validations = [
        () => validators.userId(userId, true),
        () => validators.type(type, ['transfer'], true),
        () => validators.amount(amount, true),
        () => validators.remark(remark, false)
    ]
    if (validateInputFields(validations, res)) return;
    const receiverId = parseInt(userId);
    const senderId = parseInt(req.auth.sub);

    await prisma.$transaction(async (prisma) => {
        const pointAmount = parseInt(amount);
        const sender = await prisma.user.findUnique({
            where: { id: senderId }
        });
        if (!sender) {
            return res.status(500).json({ 'error': 'UserId of sender not found' })
        }
        if (sender.points < pointAmount) {
            const senderPoints = sender.points;
            return res.status(400).json({ 'error': `Sender has ${senderPoints} points, but tried to send ${pointAmount} points` })
        }
        if (sender.verified === false) {
            return res.status(403).json({ 'error': 'Sender cannot send money, they need to be verified first' })
        }

        const receiver = await prisma.user.findUnique({
            where: { id: receiverId }
        });
        if (!receiver) {
            return res.status(404).json({ 'error': 'Userid of receiver not found' })
        }

        await prisma.user.update({
            where: { id: senderId },
            data: {
                points: { decrement: pointAmount }
            }
        });
        await prisma.user.update({
            where: { id: receiverId },
            data: {
                points: { increment: pointAmount }
            }
        });

        const senderTransaction = await prisma.transaction.create({
            data: {
                type: TransactionType.transfer,
                amount: -(pointAmount),
                remark: remark ?? null,
                userId: sender.id,
                createdById: sender.id,
                relatedUserId: receiver.id
            }
        });
        const receiverTransaction = await prisma.transaction.create({
            data: {
                type: TransactionType.transfer,
                amount: pointAmount,
                remark: remark ?? null,
                userId: receiver.id,
                createdById: sender.id,
                relatedUserId: sender.id
            }
        });
        await prisma.transaction.update({
            where: { id: senderTransaction.id },
            data: {
                relatedTransactionId: receiverTransaction.id
            }
        });
        await prisma.transaction.update({
            where: { id: receiverTransaction.id },
            data: {
                relatedTransactionId: senderTransaction.id
            }
        });

        const result = {
            id: senderTransaction.id,
            sender: sender.utorid,
            recipient: receiver.utorid,
            type,
            sent: pointAmount,
            remark,
            createdBy: sender.utorid
        }
        res.status(201).json(result);
    })
});

router.all('/', async (req, res) => {
    res.status(405).json({ 'error': 'Method Not Allowed' });
});

module.exports = router;