const { CLEARANCE, requireClearance, roleRank } = require('./auth_middleware');
const { validateString, validateEnum, validateDate, validateNumber, validateBoolean } = require('./utils/validators');
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

    relatedId(relatedId, type, required = false) { // must be used with type
        if (relatedId !== undefined && validateEnum(type, 'type', { required: true })) {
            return 'relatedId must be used with type. ' + validateEnum(type, 'type', ['redemption'], { required: true })
        }
        return validateNumber(relatedId, 'relatedId', { required })
    },

    promotionId(promotionId, required = false) {
        return validateNumber(promotionId, 'promotionId', { required })
    },

    amount(amount, required = false) { // must be used with operator
        if (amount !== undefined && validateEnum(operator, 'operator', ['gte', 'lte'], { required: true }))
        return validateNumber(amount, 'amount', { required })
    },

    page(page, required = false) {
        return validateNumber(page, 'page', { required });
    },

    limit(limit, required = false) {
        return validateNumber(limit, 'limit', { required });
    },
};

function validateInputFields(validations, res) {
    for (let validationFunction of validations) {
        let error = validationFunction();
        if (error) {
            res.status(400).json({ 'error': `Bad Request: ${error}` });
            return true;
        }
    }
    return false;
}

router.post('/:userId/transactions', requireClearance(CLEARANCE.REGULAR), async (req, res) => {
    const userId = req.params["userId"];
    const { type, amount, remark } = req.body;
    let validators = [
        () => validators.userId(userId, true),
        () => validators.type(type, ['transfer'], true),
        () => validators.amount(amount, true),
        () => validators.remark(remark, false)
    ]
    if (validateInputFields(validators, res)) return;

    const result = await prisma.$transaction(async (prisma) => {
        const pointAmount = parseInt(amount);
        const sender = prisma.user.findUnique({
            where: { id: parseInt(req.user.sub) }
        });
        if (!sender) {
            return res.status(500).json({ 'error': 'UserId of sender not found' })
        }
        if (sender.points < pointAmount) {
            return res.status(400).json({ 'error': `Sender has ${sender.points} points, but wants to send ${pointAmount} points` })
        }
        if (sender.verified === false) {
            return res.status(403).json({ 'error': 'Sender cannot send money, they need to be verified first' })
        }

        const receiver = prisma.user.findUnique({
            where: { id: parseInt(receiver) }
        });
        if (!receiver) {
            return res.status(404).json({ 'error': 'Userid of receiver not found' })
        }

        await prisma.user.update({
            where: { id: sender.id },
            data: {
                points: { decrement: pointAmount }
            }
        });
        await prisma.user.update({
            where: { id: receiver.id },
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

        return {
            id: senderTransaction.id,
            sender: sender.name,
            recipient: receiver.name,
            type,
            sent: pointAmount,
            remark,
            createdBy: sender.name
        }
    })
    res.status(201).json(result);
});

router.post('/me/transactions', requireClearance(CLEARANCE.REGULAR), async (req, res) => {

});

router.get('/me/transactions', requireClearance(CLEARANCE.REGULAR), async (req, res) => {

});

router.all('/', async (req, res) => {
    res.status(405).json({ 'error': 'Method Not Allowed' });
});

module.exports = router;